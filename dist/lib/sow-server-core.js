"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const sow_static_1 = require("./sow-static");
const url_1 = __importDefault(require("url"));
const getCook = (cooks) => {
    const cookies = {};
    cooks.forEach((value) => {
        const index = value.indexOf("=");
        if (index < 0)
            return;
        cookies[value.substring(0, index).trim()] = value.substring(index + 1).trim();
    });
    return cookies;
};
function parseCookie(cook) {
    if (!cook)
        return {};
    if (cook instanceof Array)
        return getCook(cook);
    if (cook instanceof Object)
        return cook;
    return getCook(cook.split(";"));
}
exports.parseCookie = parseCookie;
class Request extends http_1.IncomingMessage {
    constructor() {
        super(...arguments);
        this.q = Object.create(null);
        this.cookies = {};
        this.session = Object.create(null);
        this.path = "";
        this.ip = "";
    }
    get query() {
        return this.q.query;
    }
    init() {
        var _a;
        this.q = url_1.default.parse(this.url || "", true);
        this.path = this.q.pathname || "";
        if (this.socket.remoteAddress) {
            this.ip = this.socket.remoteAddress;
        }
        else {
            const remoteAddress = (_a = (this.headers['x-forwarded-for'] || this.connection.remoteAddress)) === null || _a === void 0 ? void 0 : _a.toString();
            if (remoteAddress)
                this.ip = remoteAddress;
        }
        this.cookies = parseCookie(this.headers.cookie);
        return this;
    }
}
exports.Request = Request;
const createCookie = (name, val, options) => {
    let str = `${name}=${val}`;
    if (options.domain)
        str += `;Domain=${options.domain}`;
    if (options.path) {
        str += `;Path=${options.path}`;
    }
    else {
        str += `;Path=/`;
    }
    if (options.expires && !options.maxAge)
        str += `;Expires=${sow_static_1.ToResponseTime(options.expires.getTime())}`;
    if (options.maxAge && !options.expires)
        str += `;Expires=${sow_static_1.ToResponseTime(Date.now() + options.maxAge)}`;
    if (options.secure)
        str += '; Secure';
    if (options.httpOnly)
        str += '; HttpOnly';
    if (options.sameSite) {
        switch (options.sameSite) {
            case true:
                str += ';SameSite=Strict';
                break;
            case 'lax':
                str += ';SameSite=Lax';
                break;
            case 'strict':
                str += ';SameSite=Strict';
                break;
            case 'none':
                str += ';SameSite=None';
                break;
        }
    }
    return str;
};
class Response extends http_1.ServerResponse {
    redirect(url) {
        return this.writeHead(this.statusCode, {
            'Location': url
        }), this.end();
    }
    set(field, value) {
        return this.setHeader(field, value), this;
    }
    cookie(name, val, options) {
        let sCookie = this.getHeader("Set-Cookie");
        if (sCookie instanceof Array) {
            this.removeHeader("Set-Cookie");
        }
        else {
            sCookie = [];
        }
        sCookie.push(createCookie(name, val, options));
        this.setHeader("Set-Cookie", sCookie);
        return this;
    }
    json(body) {
        const json = JSON.stringify(body);
        this.setHeader('Content-Type', 'application/json');
        this.setHeader('Content-Length', Buffer.byteLength(json));
        return this.end(json);
    }
    status(code) {
        this.statusCode = code;
        return this;
    }
}
exports.Response = Response;
const getRouteHandler = (reqPath, handlers) => {
    const router = handlers.filter(a => {
        if (a.regexp)
            return a.regexp.test(reqPath);
        return false;
    });
    if (router.length === 0)
        return void 0;
    if (router.length > 1) {
        let higestLen = -1;
        let index = -1;
        for (const row of router) {
            index++;
            if (!row.route)
                continue;
            if (row.route.length > higestLen) {
                higestLen = row.route.length;
            }
        }
        if (index < 0 || higestLen < 0)
            return void 0;
        return router[index];
    }
    return router[0];
};
function getRouteExp(route) {
    if (route.charAt(route.length - 1) === '/') {
        route = route.substring(0, route.length - 2);
    }
    return new RegExp(`^${route.replace(/\//gi, "\\/")}\/?(?=\/|$)`, "i");
}
exports.getRouteExp = getRouteExp;
class Application {
    constructor(server) {
        this._appHandler = [];
        this._prerequisitesHandler = [];
        this.server = server;
    }
    onError(handler) {
        if (this._onError)
            delete this._onError;
        this._onError = handler;
    }
    _handleRequest(req, res, handlers, next, isPrerequisites) {
        if (handlers.length === 0)
            return next();
        let isRouted = false;
        let count = 0;
        const Loop = () => {
            const inf = handlers[count];
            if (!inf)
                return next();
            if (!inf.route || isPrerequisites === true)
                return inf.handler.call(this, req, res, _next);
            if (isRouted)
                return _next();
            const layer = getRouteHandler(req.path.substring(0, req.path.lastIndexOf("/")) || "/", handlers);
            isRouted = true;
            if (layer) {
                if (layer.regexp)
                    req.path = req.path.replace(layer.regexp, "");
                return layer.handler.call(this, req, res, _next);
            }
            return _next();
        };
        function _next(statusCode) {
            if (statusCode instanceof Error) {
                return next(statusCode);
            }
            count++;
            return Loop();
        }
        return Loop();
    }
    handleRequest(req, res) {
        this._handleRequest(req, res, this._prerequisitesHandler, (err) => {
            if (err) {
                if (res.headersSent)
                    return;
                if (this._onError) {
                    return this._onError(req, res, err);
                }
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end("Error found...." + err.message);
                return;
            }
            this._handleRequest(req, res, this._appHandler, (err) => {
                if (res.headersSent)
                    return;
                if (this._onError) {
                    return this._onError(req, res, err);
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`Can not ${req.method} ${req.path}....`);
            }, false);
        }, true);
    }
    prerequisites(handler) {
        if (typeof (handler) !== "function")
            throw new Error("handler should be function....");
        return this._prerequisitesHandler.push({ handler, regexp: void 0 }), this;
    }
    use(...args) {
        const argtype0 = typeof (args[0]);
        const argtype1 = typeof (args[1]);
        if (argtype0 === "function") {
            return this._appHandler.push({ handler: args[0], regexp: void 0 }), this;
        }
        if (argtype0 === "string" && argtype1 === "function") {
            return this._appHandler.push({ route: args[0], handler: args[1], regexp: getRouteExp(args[0]) }), this;
        }
        throw new Error("Invalid arguments...");
    }
    listen(handle, listeningListener) {
        this.server.listen(handle, listeningListener);
        return this;
    }
}
exports.Application = Application;
class Apps {
    onError(handler) {
        throw new Error("Method not implemented.");
    }
    use(..._args) {
        throw new Error("Method not implemented.");
    }
    getHttpServer() {
        throw new Error("Method not implemented.");
    }
    listen(_handle, listeningListener) {
        throw new Error("Method not implemented.");
    }
    handleRequest(req, res) {
        throw new Error("Method not implemented.");
    }
    prerequisites(handler) {
        throw new Error("Method not implemented.");
    }
}
exports.Apps = Apps;
function App() {
    const _app = new Application(http_1.createServer((request, response) => {
        const req = Object.setPrototypeOf(request, Request.prototype);
        const res = Object.setPrototypeOf(response, Response.prototype);
        req.init();
        _app.handleRequest(req, res);
    }));
    const _apps = new Apps();
    _apps.onError = (handler) => {
        return _app.onError(handler);
    };
    _apps.prerequisites = (handler) => {
        return _app.prerequisites(handler), _apps;
    };
    _apps.getHttpServer = () => {
        return _app.server;
    };
    _apps.use = (...args) => {
        return _app.use.apply(_app, Array.prototype.slice.call(args)), _apps;
    };
    _apps.listen = (handle, listeningListener) => {
        return _app.listen(handle, listeningListener), _apps;
    };
    return _apps;
}
exports.App = App;
//# sourceMappingURL=sow-server-core.js.map