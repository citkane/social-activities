/* eslint-disable prefer-promise-reject-errors */
/* eslint-disable func-names */
/* eslint-disable class-methods-use-this */

const zmq = require('zeromq');
const config = require('config');

const network = config.get('network');
const serverTimeout = 2000;
const serverTimeoutMsg = {
    status: 408,
    message: 'Server timed out for request'
};
const serverErrorMsg = {
    status: 500,
    message: 'internal server error'
};
const malformedErrorMsg = {
    status: 400,
    message: 'malformed api call'
};

function makeRequest(resource, args = [], ownerId) {
    let thisArgs = args;
    if (!Array.isArray(thisArgs)) thisArgs = [thisArgs];
    return new Promise((resolve, reject) => {
        const split = resource.split('.');
        const action = split[0];
        const command = split[1];
        if (!action || !command) reject(malformedErrorMsg);
        resolve({
            ownerId,
            action,
            command,
            args: thisArgs
        });
    });
}

function GetReqSocket(type) {
    this.type = type;
    this.socket = zmq.socket('req');
}

GetReqSocket.prototype.send = async function (ownerId, action, command, args) {
    try {
        const request = makeRequest(ownerId, action, command, args);
        return this.proxy(request);
    } catch (err) {
        return err;
    }
};

GetReqSocket.prototype.proxy = function (request) {
    let mess = request;
    if (typeof mess === 'object') mess = JSON.stringify(mess);
    return new Promise((resolve, reject) => {
        const socket = zmq.socket('req');
        socket.connect(`tcp://${network[this.type].host}:${network[this.type].crud}`);
        socket.send(mess);
        const timer = setTimeout(() => {
            socket.close();
            reject(serverTimeoutMsg);
        }, serverTimeout);
        socket.on('message', (msg) => {
            try {
                const m = JSON.parse(msg.toString());
                resolve(m);
            } catch (err) {
                console.log(err);
                reject(serverErrorMsg);
            } finally {
                clearTimeout(timer);
                socket.close();
            }
        });
    });
};

class BaseApi {
    constructor(sockets) {
        this.builder = (action, path, args = [], ownerId) => {
            let thisArgs = args;
            const route = path.split('.');
            if (route.length !== 2) return this.reject();
            const type = route[0];
            const command = route[1];
            if (!Array.isArray(thisArgs)) thisArgs = [thisArgs];
            const req = this.getReqSocket(type);
            return req.send(ownerId, action, command, args);
        };
        this.api = {
            create: (path, args, ownerId = null) => this.builder('create', path, args || [], ownerId),
            read: (path, args, ownerId = null) => this.builder('read', path, args || [], ownerId),
            update: (path, args, ownerId = null) => this.builder('update', path, args || [], ownerId),
            delete: (path, args, ownerId = null) => this.builder('delete', path, args || [], ownerId)
        };

        /** @todo write the documentation */
        this.makeRequest = makeRequest;

        /** @namespace module:activities.pubsub */
        this.sockets = sockets;
        /**
         * Publish a payload to a topic for all subscribed microservices.
         * @method module:activities.pubsub#publish
         * @param {String} topic - The topic to publish.
         * @param {any} data - the payload to publish to the topic.
         */
        this.publish = function (...args) { return sockets.publish(args); };
        /**
         * Subscribe to a topic.
         * @method module:activities.pubsub#subscribe
         * @param {String} topic - The topic to subscribe to.
         */
        this.subscribe = function (...args) { return sockets.subscribe(args); };
        /**
         * Unsubscribe from a topic.
         * @method module:activities.pubsub#unsubscribe
         * @param {String} topic - The topic to unsubscribe from.
         */
        this.unsubscribe = function (...args) { return sockets.unsubscribe(args); };
        /**
         * @method module:activities.pubsub#on
         * @param {String} topic - The topic to subscribe to;
         * @param {Function} callBack - The function to call when a subscribed topic is recieved.
         * @example
         * api.on('myTopic', (data) => {...});
         */
        this.on = function (...args) { return sockets.subscriber.on(args); };
    }

    /** @todo write the documentation */
    getReqSocket(type) {
        if (!type) return GetReqSocket;
        return new GetReqSocket(type);
    }

    /** @todo write the documentation */
    reject(status, message = 'error') {
        if (!status || typeof status !== 'number') return Promise.reject(malformedErrorMsg);
        return Promise.reject({ status, message });
    }

    /** @todo write the documentation */
    resolve(status, payload = false) {
        if (!status || typeof status !== 'number') return this.reject();
        return Promise.resolve({ status, payload });
    }
}

module.exports = BaseApi;
