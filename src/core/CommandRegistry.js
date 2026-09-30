'use strict';

const fs = require('fs');
const path = require('path');
const CommandContext = require('./CommandContext');

class CommandRegistry {
  constructor({ commandsDir, config, db, permissions, logger, state, services = {}, pluginManager = null }) {
    Object.assign(this, { commandsDir, config, db, permissions, logger, state, services, pluginManager });
    this.commands = new Map();
    this.aliases = new Map();
    this.cooldowns = new Map();
  }

  _commandDirs() {
    return [this.commandsDir, ...(this.pluginManager?.commandDirs?.() || [])].filter(Boolean);
  }

  load() {
    this.commands.clear();
    this.aliases.clear();
    const files = [];
    for (const dir of this._commandDirs()) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter(item => item.endsWith('.js')).sort()) {
        files.push({ dir, file });
      }
    }

    for (const { dir, file } of files) {
      const fullPath = path.join(dir, file);
      delete require.cache[require.resolve(fullPath)];
      try {
        const command = require(fullPath);
        if (!command || typeof command !== 'object' || !command.name || typeof command.execute !== 'function') {
          this.logger.warn('Skipping invalid command module: ' + file);
          continue;
        }

        const normalized = {
          aliases: [],
          category: 'general',
          description: 'No description provided.',
          usage: null,
          role: 0,
          cooldown: 0,
          ...command
        };
        normalized.name = String(normalized.name).trim().toLowerCase();
        normalized.aliases = [...new Set(
          (Array.isArray(normalized.aliases) ? normalized.aliases : [normalized.aliases])
            .filter(v => v !== null && v !== undefined)
            .map(String).map(v => v.trim().toLowerCase()).filter(Boolean)
        )];
        normalized.category = String(normalized.category || 'general').trim().toLowerCase();
        normalized.description = String(normalized.description || 'No description provided.').trim();
        normalized.role = Number.isFinite(Number(normalized.role)) ? Math.max(0, Math.floor(Number(normalized.role))) : 0;
        normalized.cooldown = Number.isFinite(Number(normalized.cooldown)) ? Math.max(0, Number(normalized.cooldown)) : 0;

        if (!normalized.name || /\s/.test(normalized.name)) {
          this.logger.warn('Skipping command with invalid name in ' + file + '.');
          continue;
        }
        if (this.commands.has(normalized.name) || this.aliases.has(normalized.name)) {
          this.logger.warn('Skipping duplicate command name: ' + normalized.name);
          continue;
        }

        const usableAliases = [];
        for (const alias of normalized.aliases) {
          if (alias === normalized.name || this.commands.has(alias) || this.aliases.has(alias)) {
            this.logger.warn('Ignoring conflicting alias "' + alias + '" on command ' + normalized.name + '.');
            continue;
          }
          usableAliases.push(alias);
        }
        normalized.aliases = usableAliases;
        this.commands.set(normalized.name, normalized);
        for (const alias of normalized.aliases) this.aliases.set(alias, normalized.name);
      } catch (error) {
        this.logger.error('Failed to load command ' + file + ':', error);
      }
    }

    this.logger.info('Loaded ' + this.commands.size + ' command(s).');
    return this;
  }

  get(name) {
    const key = String(name || '').trim().toLowerCase();
    return this.commands.get(key) || this.commands.get(this.aliases.get(key));
  }

  list() { return [...this.commands.values()]; }

  _cooldownKey(command, userID, threadID) {
    return command.name + ':' + (threadID || 'global') + ':' + (userID || 'unknown');
  }

  _remainingCooldown(command, userID, threadID) {
    const seconds = Number(command.cooldown || 0);
    if (seconds <= 0) return 0;
    const key = this._cooldownKey(command, userID, threadID);
    const expiresAt = this.cooldowns.get(key) || 0;
    if (expiresAt <= Date.now()) {
      this.cooldowns.delete(key);
      return 0;
    }
    return expiresAt - Date.now();
  }

  _setCooldown(command, userID, threadID) {
    const seconds = Number(command.cooldown || 0);
    if (seconds > 0) this.cooldowns.set(this._cooldownKey(command, userID, threadID), Date.now() + seconds * 1000);
  }

  _prefixFor(threadID) {
    return this.db.getGroup?.(threadID)?.prefix || this.config.get('prefix', '/');
  }

  _isGroupApproved(threadID) {
    const group = this.db.getGroup?.(threadID);
    if (group?.approved === true) return true;
    const allowed = this.config.get('allowedGroups', []);
    return Array.isArray(allowed) && allowed.map(String).includes(String(threadID));
  }

  async execute(api, message) {
    if (!api?.sendMessage || !message?.threadID) return false;
    const prefix = String(this._prefixFor(message.threadID) || '/');
    const body = String(message.body || '').trim();
    if (!prefix || !body.startsWith(prefix)) return false;

    const input = body.slice(prefix.length).trim();
    if (!input) return false;
    const tokens = input.split(/\s+/);
    const name = tokens.shift()?.toLowerCase();
    if (!name) return false;

    const command = this.get(name);
    if (!command) return false;
    const group = this.db.getGroup?.(message.threadID);

    if (group && !this._isGroupApproved(message.threadID) && command.name !== 'approve') {
      await api.sendMessage(
        this.services.formatter?.box('Approval Required', [
          'MATEO-FMB is present, but this group is not approved yet.',
          'Commands are locked until a bot admin approves this thread.',
          'Ask a bot admin to use ' + prefix + 'approve ' + message.threadID
        ]) || 'MATEO-FMB is awaiting approval.',
        message.threadID
      );
      return true;
    }

    if (group && group.enabled === false && !['start', 'approve'].includes(command.name)) {
      await api.sendMessage('MATEO-FMB is disabled here. Ask a bot admin to use ' + prefix + 'start.', message.threadID);
      return true;
    }

    if (!this.permissions.hasLevel(message.senderID, message.threadID, command.role)) {
      const formatter = this.services.formatter;
      await api.sendMessage(formatter?.error('You do not have permission to use this command.') || 'You do not have permission to use this command.', message.threadID);
      return true;
    }

    const remaining = this._remainingCooldown(command, message.senderID, message.threadID);
    if (remaining > 0) {
      const wait = 'Please wait ' + Math.ceil(remaining / 1000) + 's before using this command again.';
      await api.sendMessage(this.services.formatter?.error(wait) || wait, message.threadID);
      return true;
    }

    const ctx = new CommandContext({
      api, message, args: tokens, command, db: this.db, config: this.config,
      permissions: this.permissions, logger: this.logger, registry: this, services: this.services
    });
    ctx.group = group || this.services.groups?.get?.(message.threadID);
    ctx.user = await this.db.ensureUser?.(message.senderID, message.senderName || '');

    const run = async () => {
      try {
        if (command.legacy === true || command.execute.length > 1) {
          await command.execute(api, message, tokens, this.db, this.config.all(), () => {}, () => {}, () => {});
        } else {
          await command.execute(ctx);
        }
        this._setCooldown(command, message.senderID, message.threadID);
        if (ctx.user) {
          ctx.user.commandsUsed = (ctx.user.commandsUsed || 0) + 1;
          await this.db.write();
        }
        this.state?.incrementStat('commandsExecuted');
        return true;
      } catch (error) {
        this.state?.incrementStat('errorsEncountered');
        this.logger.error('Command ' + command.name + ' failed:', error);
        const text = this.services.formatter?.error('Something went wrong while executing that command.') || 'Something went wrong while executing that command.';
        try { await api.sendMessage(text, message.threadID); } catch (sendError) { this.logger.error('Failed to send command error response:', sendError); }
        return true;
      }
    };

    try {
      return this.services.performance?.run ? await this.services.performance.run(run) : await run();
    } catch (error) {
      this.logger.warn('Command ' + command.name + ' rejected by performance limiter: ' + error.message);
      const text = this.services.formatter?.error('The bot is busy right now. Please try again shortly.') || 'The bot is busy right now. Please try again shortly.';
      try { await api.sendMessage(text, message.threadID); } catch (sendError) { this.logger.error('Failed to send overload response:', sendError); }
      return true;
    }
  }
}

module.exports = CommandRegistry;
