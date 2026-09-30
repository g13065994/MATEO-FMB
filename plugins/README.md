# MATEO-FMB Plugins

Place one plugin per directory.

Example:

    plugins/my-plugin/
      manifest.json
      commands/
        hello.js
      events/
        message.js

Manifest example:

    {
      "name": "my-plugin",
      "version": "1.0.0",
      "commands": "commands",
      "events": "events"
    }

Plugins load only when plugins.enabled is true and the plugin name is not in plugins.disabled.

Keep third-party plugins auditable and pin their dependencies separately. Never place secrets inside a plugin directory.
