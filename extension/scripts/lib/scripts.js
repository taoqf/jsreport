﻿/*! 
 * Copyright(c) 2014 Jan Blaha 
 *
 * Extension allowing to run custom scripts and modify request before rendering process starts.
 */

var shortid = require("shortid"),
    _ = require("underscore"),
    path = require("path"),
    q = require("q");

module.exports = function (reporter, definition) {
    reporter[definition.name] = new Scripts(reporter, definition);
};

var Scripts = function (reporter, definition) {
    this.reporter = reporter;
    this.definition = definition;

    this._defineEntities();

    this.reporter.beforeRenderListeners.add(definition.name, this, Scripts.prototype.handleBeforeRender);

    this.allowedModules = ["handlebars", "request-json", "feedparser", "request", "underscore"];
};

Scripts.prototype.create = function (context, script) {
    var entity = new this.ScriptType(script);
    context.scripts.add(entity);
    return context.scripts.saveChanges().then(function () {
        return q(entity);
    });
};

Scripts.prototype.handleBeforeRender = function (request, response) {
    var self = this;

    if (!request.template.scriptId && !request.template.script) {
        self.reporter.logger.info("ScriptId not defined for this template.");
        return q();
    }

    function findScript() {
        if (request.template.script && request.template.script !== "")
            return q(request.template.script);

        self.reporter.logger.debug("Searching for before script to apply - " + request.template.scriptId);

        return request.context.scripts.single(function (s) {
            return s.shortid === this.id;
        }, { id: request.template.scriptId });
    }

    return findScript().then(function (script) {
        script = script.content || script;

        return request.taskManager.execute({
            body: {
                script: script,
                allowedModules: self.allowedModules,
                request: {
                    data: request.data,
                    template: {
                        content: request.template.content,
                        helpers: request.template.helpers
                    }
                },
                response: response
            },
            execModulePath: path.join(__dirname, "scriptEvalChild.js"),
            timeout: 60000
        }).then(function(body) {
            request.data = body.request.data;
            request.template.content = body.request.template.content;
            request.template.helpers = body.request.template.helpers;

            return response;
        });
    });
};

Scripts.prototype._beforeCreateHandler = function (args, entity) {
    if (!entity.shortid)
        entity.shortid = shortid.generate();

    entity.creationDate = new Date();
    entity.modificationDate = new Date();
};

Scripts.prototype._beforeUpdateHandler = function (args, entity) {
    entity.modificationDate = new Date();
};

Scripts.prototype._defineEntities = function() {

    this.ScriptType = this.reporter.dataProvider.createEntityType("ScriptType", {
        shortid: { type: "string"},
        creationDate: { type: "date" },
        modificationDate: { type: "date" },
        content: { type: "string" },
        name: { type: "string" }
    });

    this.ScriptType.addMember("_id", { type: "id", key: true, computed: true, nullable: false });
    this.reporter.templates.TemplateType.addMember("scriptId", { type: "string" });

    this.ScriptType.addEventListener("beforeCreate", Scripts.prototype._beforeCreateHandler.bind(this));
    this.ScriptType.addEventListener("beforeUpdate", Scripts.prototype._beforeUpdateHandler.bind(this));

    this.reporter.dataProvider.registerEntitySet("scripts", this.ScriptType, { tableOptions: { humanReadableKeys: [ "shortid"] }  });
}