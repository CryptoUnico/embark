import * as fs from './fs';
import { Plugin } from './plugin';
import { EmbarkEmitter as Events } from './events';
import { Config } from './config';

import * as async from 'async';
import { dappPath, embarkPath } from 'embark-utils';
import { Logger } from 'embark-logger';

export class Plugins {

  pluginList = [];

  interceptLogs: boolean;

  plugins: Plugin[] = [];

  logger: Logger;

  events: Events;

  config: Config;

  context: any;

  fs: any;

  env: string;

  version: string;

  debugLog: any;

  static deprecated = {
    'embarkjs-connector-web3': '4.1.0'
  };

  constructor(options) {
    this.pluginList = options.plugins || [];
    this.interceptLogs = options.interceptLogs;
    // TODO: need backup 'NullLogger'
    this.logger = options.logger;
    this.events = options.events;
    this.config = options.config;
    this.debugLog = options.debugLog;
    this.context = options.context;
    this.fs = fs;
    this.env = options.env;
    this.version = options.version;
  }

  loadPlugins() {
    Object.entries(Plugins.deprecated).forEach(([pluginName, embarkVersion]) => {
      if (this.pluginList[pluginName]) {
        delete this.pluginList[pluginName];
        this.logger.warn(`${pluginName} plugin was not loaded because it has been deprecated as of embark v${embarkVersion}, please remove it from this project's embark.json and package.json`);
      }
    });
    Object.entries(this.pluginList).forEach(([pluginName, pluginConfig]) => {
      this.loadPlugin(pluginName, pluginConfig);
    });
  }

  listPlugins() {
    return this.plugins.reduce((list: string[], plugin) => {
      if (plugin.loaded) {
        list.push(plugin.name);
      }
      return list;
    }, []);
  }

  // for services that act as a plugin but have core functionality
  createPlugin(pluginName, pluginConfig) {
    const plugin = {};
    const pluginPath = false;
    const pluginWrapper = new Plugin({
      name: pluginName,
      pluginModule: plugin,
      pluginConfig,
      logger: this.logger,
      debugLog: this.debugLog,
      pluginPath,
      interceptLogs: this.interceptLogs,
      events: this.events,
      config: this.config,
      plugins: this.plugins,
      fs: this.fs,
      isInternal: true,
      context: this.context
    });
    this.plugins.push(pluginWrapper);
    return pluginWrapper;
  }

  loadInternalPlugin(pluginName, pluginConfig, isPackage?: boolean) {
    let pluginPath, plugin;
    if (isPackage) {
      pluginPath = pluginName;
      plugin = require(pluginName);
    } else {
      pluginPath = embarkPath('dist/lib/modules/' + pluginName);
      plugin = require(pluginPath);
    }

    if (plugin.default) {
      plugin = plugin.default;
    }

    const pluginWrapper = new Plugin({
      name: pluginName,
      pluginModule: plugin,
      pluginConfig: pluginConfig || {},
      logger: this.logger,
      debugLog: this.debugLog,
      pluginPath,
      interceptLogs: this.interceptLogs,
      events: this.events,
      config: this.config,
      plugins: this.plugins,
      fs: this.fs,
      isInternal: true,
      context: this.context,
      env: this.env
    });
    const pluginInstance = pluginWrapper.loadInternalPlugin();
    this.plugins.push(pluginWrapper);
    return pluginInstance;
  }

  loadPlugin(pluginName, pluginConfig) {
    const pluginPath = dappPath('node_modules', pluginName);
    let plugin = require(pluginPath);

    if (plugin.default) {
      plugin = plugin.default;
    }

    let logId = this.debugLog.moduleInit(pluginName);
    let events = this.debugLog.tagObject(this.events, logId);
    let logger = this.debugLog.tagObject(this.logger, logId);

    const pluginWrapper = new Plugin({
      name: pluginName,
      pluginModule: plugin,
      pluginConfig,
      logger: this.logger,
      debugLog: this.debugLog,
      logId: logId,
      events: events,
      pluginPath,
      interceptLogs: this.interceptLogs,
      events: this.events,
      config: this.config,
      plugins: this.plugins,
      fs: this.fs,
      isInternal: false,
      context: this.context,
      version: this.version
    });
    pluginWrapper.loadPlugin();
    this.plugins.push(pluginWrapper);
  }

  getPluginsFor(pluginType) {
    return this.plugins.filter(function(plugin) {
      return plugin.has(pluginType);
    });
  }

  getPluginsProperty(pluginType, property, sub_property?: any) {
    const matchingPlugins = this.plugins.filter(function(plugin) {
      return plugin.has(pluginType);
    });

    // Sort internal plugins first
    matchingPlugins.sort((a, b) => {
      if (a.isInternal) {
        return -1;
      }
      if (b.isInternal) {
        return 1;
      }
      return 0;
    });

    let matchingProperties = matchingPlugins.map((plugin) => {
      if (sub_property) {
        return plugin[property][sub_property];
      }
      return plugin[property];
    });

    // Remove empty properties
    matchingProperties = matchingProperties.filter((property) => property);

    // return flattened list
    if (matchingProperties.length === 0) { return []; }
    return matchingProperties.reduce((a, b) => a.concat(b)) || [];
  }

  getPluginsPropertyAndPluginName(pluginType, property, sub_property) {
    const matchingPlugins = this.plugins.filter(function(plugin) {
      return plugin.has(pluginType);
    });

    // Sort internal plugins first
    matchingPlugins.sort((a, b) => {
      if (a.isInternal) {
        return -1;
      }
      if (b.isInternal) {
        return 1;
      }
      return 0;
    });

    let matchingProperties: any[] = [];
    matchingPlugins.map((plugin) => {
      if (sub_property) {
        const newList = [];
        for (const kall of (plugin[property][sub_property] || [])) {
          matchingProperties.push([kall, plugin.name]);
        }
        return newList;
      }

      const newList = [];
      for (const kall of (plugin[property] || [])) {
        matchingProperties.push([kall, plugin.name]);
      }
      return newList;
    });

    // Remove empty properties
    matchingProperties = matchingProperties.filter((property) => property[0]);

    // return flattened list
    if (matchingProperties.length === 0) { return []; }
    // return matchingProperties.reduce((a,b) => { return a.concat(b); }) || [];
    return matchingProperties;
  }

  // TODO: because this is potentially hanging, we should issue a trace warning if the event does not exists
  runActionsForEvent(eventName, args, cb, logId) {
    const self = this;
    if (typeof (args) === 'function') {
      cb = args;
      args = [];
    }
    const actionPlugins = this.getPluginsPropertyAndPluginName('eventActions', 'eventActions', eventName);

    if (actionPlugins.length === 0) {
      return cb(null, args);
    }

    actionPlugins.sort((a, b) => {
      const aPriority = a[0].options.priority;
      const bPriority = b[0].options.priority;
      if (aPriority < bPriority) {
        return -1;
      }
      if (aPriority > bPriority) {
        return 1;
      }
      return 0;
    });

    this.debugLog.log({parent_id: logId, type: "trigger_action", name: eventName, givenLogId: logId, plugins: actionPlugins, inputs: args});

    async.reduce(actionPlugins, args, function(current_args, pluginObj: any, nextEach) {
      const [plugin, pluginName] = pluginObj;

      let actionLogId = self.debugLog.log({module: pluginName, type: "action_run", name: (eventName + plugin.name), source: pluginName, inputs: current_args});

      if (typeof (args) === 'function') {
        plugin.action.call(plugin.action, (...params) => {
          self.debugLog.log({id: actionLogId, outputs: params || current_args});
          return nextEach(...params || current_args);
        });
      } else {
        plugin.action.call(plugin.action, args, (...params) => {
          self.debugLog.log({id: actionLogId, outputs: (args, params || current_args)});
          return nextEach(...params || current_args);
        });
      }
    }, cb);
  }

  emitAndRunActionsForEvent(eventName, args, cb, logId) {
    if (typeof (args) === 'function') {
      cb = args;
      args = [];
    }
    this.events.emit(eventName, args);
    return this.runActionsForEvent(eventName, args, cb, logId);
  }
}