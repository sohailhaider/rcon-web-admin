"use strict";

/**
 * Socket stuff
 */
var Socket = {};

/** @type {WebSocket} */
Socket.con = null;

/** @type {function[]} */
Socket.callbacks = [];

/** @type {object} */
Socket.queue = [];

/** @type {{}} */
Socket.onMessageEvents = {};

/** @type {{}} */
Socket.config = {};

/**
 * Bind a callback to be triggered everytime a message is received
 * @param {string} id The handler id
 * @param {NodeMessageCallback} callback
 */
Socket.onMessage = function (id, callback) {
    Socket.onMessageEvents[id] = callback;
};

/**
 * Unbind a callback
 * @param {string} id
 */
Socket.offMessage = function (id) {
    delete Socket.onMessageEvents[id];
};

/**
 * Send the queue
 */
Socket.sendQueue = function () {
    // send all messages in the queue
    for (var i = 0; i < Socket.queue.length; i++) {
        var q = Socket.queue[i];
        Socket.send(q.action, q.messageData, q.callback);
    }
    Socket.queue = [];
};

/**
 * Connect to websocket
 * @param {function=} callback If connection is established
 */
Socket.connect = function (callback) {
    var cb = function () {
        var url = 'ws://' + window.location.hostname + ':' + Socket.config.port
        if(location.protocol === 'https:' && Socket.config.sslUrl !== null){
            url = Socket.config.sslUrl
        } else if(Socket.config.url !== null){
            url = Socket.config.url
        }
        var con = new WebSocket(url);
        /**
         * On open connection
         */
        con.onopen = function () {
            Interval.destroy("socket.reconnect");
            Socket.con = con;
            // send init ping to backend
            Socket.send("init", null, function (messageData) {
                if (messageData.package.version) {
                    $(".app-version").text(messageData.package.version);
                    if (messageData.latestVersion && messageData.latestVersion != messageData.package.version) {
                        $(".top-logo .update").removeClass("hidden");
                    }
                }
                if (callback) callback(messageData);
                Socket.sendQueue();
            });
        };

        /**
         * On websocket error
         * @param error
         */
        con.onerror = function (error) {
            console.error('WebSocket Error ' + error);
        };

        /**
         * On message received from backend
         */
        con.onmessage = function (e) {
            if (e.data) {
                var data = JSON.parse(e.data);
                debug("Socket receive message", data);
                if (data.action) {
                    if (typeof data.callbackId != "undefined") {
                        var callbackId = data.callbackId;
                        if (Socket.callbacks[callbackId] === null) {
                            console.error("No socket callback for id " + callbackId + ", maybe dupe callback in backend?");
                        } else {
                            Socket.callbacks[callbackId](data.messageData);
                            Socket.callbacks[callbackId] = null;
                        }
                    }
                    for (var i in Socket.onMessageEvents) {
                        if (Socket.onMessageEvents.hasOwnProperty(i)) {
                            var cb = Socket.onMessageEvents[i];
                            if (cb) cb(data);
                        }
                    }
                    // show server disconnect message
                    if (data.action == "serverDisconnect") {
                        note(t("server.disconnect") + ": " + data.messageData.servername, "danger");
                    }
                }
            }
        };

        /**
         * On connection close
         */
        con.onclose = function () {
            Socket.con = null;
            // reload page after 5 seconds
            note("socket.disconnect", "danger");
            spinner("#content");
            setTimeout(function () {
                window.location.reload();
            }, 5000);
        };
    };
    if (Socket.port) {
        cb();
    } else {
        // load the required ws config
        $.getJSON("wsconfig", function (config) {
            Socket.config = config
            cb();
        });
    }
};

/**
 * Connect to socket and load view for current url hash
 */
Socket.connectAndLoadView = function () {
    Socket.connect(function () {
        var view = "index";
        var messageData = null;
        var hashData = View.getViewDataByHash();
        if (hashData.view) {
            view = hashData.view;
        }
        if (hashData.messageData) {
            messageData = hashData.messageData;
        }
        View.load(view, messageData);
    });
};

/**
 * Send a command to the backend
 * @param {string} action
 * @param {object=} messageData
 * @param {function=} callback
 */
Socket.send = function (action, messageData, callback) {
    var receiveCallback = function (receivedMessage) {
        if (receivedMessage.note) {
            note(receivedMessage.note.message, receivedMessage.note.type);
        }
        if (receivedMessage.error) {
            var message = "Server Error: " + receivedMessage.error.message;
            if (receivedMessage.error.stack) {
                message = "<strong>Server Error</strong>\n" + receivedMessage.error.stack;
            }
            $("#content").html($('<div class="alert alert-danger" style="white-space: pre-wrap"></div>').html(message));
            Socket.callbacks = [];
            return;
        }
        if (callback) callback(receivedMessage);
    };
    if (typeof messageData == "undefined") {
        messageData = null;
    }
    // if connection not yet established add to queue
    if (Socket.con === null) {
        Socket.queue.push({
            "action": action,
            "messageData": messageData,
            "callback": callback
        });
        return;
    }
    var data = {
        "action": action,
        "callbackId": Socket.callbacks.length,
        "messageData": messageData,
        "loginName": Storage.get("loginName"),
        "loginHash": Storage.get("loginHash")
    };
    Socket.callbacks.push(receiveCallback);
    Socket.con.send(JSON.stringify(data));
    debug("Socket sent message", data);
};