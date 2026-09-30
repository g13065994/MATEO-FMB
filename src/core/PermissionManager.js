'use strict';

const LEVELS = Object.freeze({ USER: 0, GROUP_ADMIN: 1, BOT_ADMIN: 2, OWNER: 3 });
const normalizeIDs = value => new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String));

class PermissionManager {
  constructor(config, db) {
    this.config = config;
    this.db = db;
  }

  ownerID() { return String(this.config.get('ownerID', '') || ''); }
  adminIDs() { return normalizeIDs(this.config.get('adminIDs', [])); }

  _group(threadID) {
    if (this.db?.getGroup) return this.db.getGroup(threadID);
    return this.db?.data?.groups?.find(group => String(group.threadID) === String(threadID)) || null;
  }

  levelFor(userID, threadID) {
    if (!userID) return LEVELS.USER;
    const id = String(userID);
    if (this.ownerID() && this.ownerID() === id) return LEVELS.OWNER;
    if (this.adminIDs().has(id)) return LEVELS.BOT_ADMIN;

    const group = this._group(threadID);
    if (normalizeIDs(group?.adminIDs).has(id)) return LEVELS.GROUP_ADMIN;
    return LEVELS.USER;
  }

  hasLevel(userID, threadID, requiredLevel) {
    const required = Number.isFinite(Number(requiredLevel)) ? Math.max(0, Number(requiredLevel)) : LEVELS.USER;
    return this.levelFor(userID, threadID) >= required;
  }

  isOwner(userID) { return Boolean(userID) && this.ownerID() === String(userID); }
  isBotAdmin(userID, threadID) { return this.levelFor(userID, threadID) >= LEVELS.BOT_ADMIN; }
  isGroupAdmin(userID, threadID) { return this.levelFor(userID, threadID) >= LEVELS.GROUP_ADMIN; }
}

PermissionManager.LEVELS = LEVELS;
module.exports = PermissionManager;
