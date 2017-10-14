const Bot = require('./lib/Bot')
const SOFA = require('sofa-js')
const Fiat = require('./lib/Fiat')
const Logger = require('./lib/Logger');
const constants = require('./constants');

let bot = new Bot()

// ROUTING

// Session STATES
// 1 - Init
// 2 - register start
// 3 - register price
// 4 - register location
// 5 - List lms
// 6 - Select lm from list
// 7 - renting from someone
// 8 - renting out

/**
  * All events go through this method.
  * Bot logic starts here.
  *
  * "Init" - called once, when app is launched by user
  * "Command" - a button/menu was pressed by user
  * "Message" - message received from user
  * "Payment" - payment from user received
  * "PaymentRequest" - payment request from user
  */
bot.onEvent = function(session, message) {
    Logger.info("User: " + session.user.name); //JSON.stringify(session.user));
    Logger.info("State: " + session.get("state")); //JSON.stringify(session.user));
    Logger.info("onEvent - message = " + message.type);
    switch (message.type) {
        case 'Init':
            welcome(session)
            break
        case 'Command':
            onCommand(session, message)
            break
        case 'Message':
            onMessage(session, message)
            break
        case 'Payment':
            onPayment(session, message)
            break
        case 'PaymentRequest':
            Logger.info("Payment request - no action");
            welcome(session)
            break
    }
}

/**
  * Handle command (button/menu press) from user.
  */
function onCommand(session, command) {
    Logger.info("onCommand - message = " + command.content.value);
    switch (command.content.value) {
        case "register":
            session.set("state", 2);
            registerLawnMower_getPrice(session)
            break
        case 'find':
            session.set("state", 5);
            findLawnMower(session)
            break
        case "returned":
            session.set("state", 9);
            returnLawnMower(session);
            break
    }
}

/**
  * Handle message from user.
  */
function onMessage(session, message) {
    Logger.info("onMessage - message = " + message.body);
    if (message.body == "clear") {
        bot.client.store.setKey('registrations', null);
        session.set("state", 1);
    }

    if (message.body == "cancel") {
        session.set("state", 1);
    }

    checkIfIAmRenting(session);
    checkIfIAmRentingOut(session);
    checkDeposit(session);

    if (session.get("state") == 8) {
        let controls = [
          {type: 'button', label: "Lawn mower returned alright", value: "returned"}
        ];
        let msg = "You are currently renting out your lawn mower";
        session.reply(SOFA.Message({
            controls: controls,
            body: msg,
            showKeyboard: false,
        }));
    } else if (session.get("state") == 3) {
        // check it is a number
        Logger.info("message = " + message.body);
        session.set("price", message.body);
        registerLawnMower_getLocation(session);
    } else if (session.get("state") == 4) {
        // check it is a location
        session.set("location", message.body);
        registerLawnMower_insert(session);
    } else if (session.get("state") == 5) {
        // check if you are not already renting
        // check if you put a number and there is a rental with that number
        session.set("renting", message.body);
        // fIXME
        // session.set("state", 1);
        selectedLawnMowerToRent(session);
    } else if (session.get("state") == 1) {
        welcome(session);
    }
}

/**
  * Handle payment to bot state (unconfirmed/confirmed).
  */
function onPayment(session, message) {
    Logger.info("Payment: " + JSON.stringify(message));

    if (message.status == "confirmed") {
        Logger.info("PAYMENT CONFIRMED");

        Logger.info("from address: " + message.fromAddress);
        Logger.info("from user: " + session.user.name);
        Logger.info("value received: " + message.value); //fiat.AUD.fromEth(unit.fromWei(message.value, 'ether')) + " AUD");

        registerRental_insert(session);
    }
}

/**
  * Check if a deposit needs to be returned to the user.
  *
  * This is being handled through the registrations (status == 2)
  * so the bot can return the money straight to the current user
  * when he receives the message.
  */
function checkDeposit(session) {
    Logger.info("getting deposit");
    bot.client.store.getKey('registrations').then((registrations) => {
        if (registrations != null) {
            let myUserId = session.user.token_id;
            for (var i = 0; i < registrations.length; i++) {
                Logger.info("checking registrations: " + JSON.stringify(registrations[i]));
                if ((myUserId == registrations[i].renter) && (registrations[i].status == 2)) {
                    Logger.info("Found deposit to return");
                    session.set("state", 1);

                    sendMessage(session, "Your deposit is being returned.");
                    session.sendEth(Number(10 / 100), function(session, error, result) {
                        console.log(error)
                    });

                    registrations[i].status == 0; // AVAILABLE
                    bot.client.store.setKey('registrations', registrations);
                }
            }
        }
    }).catch((err) => {
        Logger.error("Error: " + err);
    });
}

/**
  * Called when user renting out a lawn mower presses
  * the returned lawn mower button.
  *
  * Return deposit from bot to lawn mower renter and
  * send rental money to user who rented out lawn mower.
  */
function returnLawnMower(session) {
    Logger.info("returning lawn mower");
    bot.client.store.getKey('registrations').then((registrations) => {
        if (registrations == null) {
        } else {
            let myUserId = session.user.token_id;
            for (var i = 0; i < registrations.length; i++) {
                Logger.info("checking registrations: " + JSON.stringify(registrations[i]));
                if ((myUserId == registrations[i].userId) && (registrations[i].status == 1)) {
                    session.set("state", 1);

                    sendMessage(session, "Thank you! Deposit will be returned to renter. And you will receive your payment.");

                    session.sendEth(Number(registrations[i].price / 100), function(session, error, result) {
                        console.log(error)
                    });

                    let userMsg = "Thank you! Lawn mower returned alright. Deposit is being returned to your account.";
                    bot.client.send(registrations[i].renter, userMsg)

                    registrations[i].status == 2; // RETURNING DEPOSIT
                    bot.client.store.setKey('registrations', registrations);

                    session.set("state", 1); // state = RENTING OUT
                }
            }
        }
    }).catch((err) => {
        Logger.error("Error: " + err);
    });
}

/**
  * Communicate to lawn mower renter that his payment was accepted
  * and he is currently renting the lawn mower.
  */
function checkIfIAmRenting(session) {
    Logger.info("check if I am renting");
    bot.client.store.getKey('registrations').then((registrations) => {
        if (registrations != null) {
            let myUserId = session.user.token_id;
            for (var i = 0; i < registrations.length; i++) {
                Logger.info("checking registrations: " + JSON.stringify(registrations[i]));
                if ((myUserId == registrations[i].renter) && (registrations[i].status == 1)) {
                    sendMessage(session, "You are currently renting a lawn mower. When you are finished cutting the grass give it back to the owner in good conditions.");

                    session.set("state", 7); // state = RENTING
                }
            }
        }
    }).catch((err) => {
        Logger.error("Error: " + err);
    });
}

/**
  * Show button to accept lawn mower back in good condition
  * for the user renting out.
  */
function checkIfIAmRentingOut(session) {
    Logger.info("check if I am renting out");
    bot.client.store.getKey('registrations').then((registrations) => {
        if (registrations == null) {
        } else {
            let myUserId = session.user.token_id;
            for (var i = 0; i < registrations.length; i++) {
                Logger.info("checking registrations: " + JSON.stringify(registrations[i]));
                if ((myUserId == registrations[i].userId) && (registrations[i].status == 1)) {
                    // let controls = [
                    //   {type: 'button', label: "Lawn mower returned alright", value: "returned"}
                    // ];
                    // session.reply(SOFA.Message({
                    //   controls: controls,
                    //   showKeyboard: false,
                    // }));

                    session.set("state", 8); // state = RENTING OUT
                }
            }
        }
    }).catch((err) => {
        Logger.error("Error: " + err);
    });
}

/**
  * Once payment has been accepted update the rental status
  * and insert the user id of the renter in registrations.
  *
  * Communicate to user renting out that a rental request
  * has been received so he can give his lawn mower to the renter.
  */
function registerRental_insert(session) {
    bot.client.store.getKey('registrations').then((registrations) => {
        if (registrations == null) {
            sendMessageMainMenu(session, "No lawn mowers have been registered..");
        } else {
            let registration = registrations[session.get("renting") - 1];
            registrations[session.get("renting") - 1].status = 1;
            registrations[session.get("renting") - 1].renter = session.user.token_id;
            bot.client.store.setKey('registrations', registrations);

            let msg = "You are renting a lawn mower!";
            msg += "\n\nFrom: " + registration.user;
            msg += "\nLocation: " + registration.location;
            msg += "\n\nNow pick it up and cut your grass!";

            session.set("state", 7); // STATUS = RENTING

            sendMessage(session, msg);

            let userMsg = "Hi " + registration.user + ",";
            userMsg += "\n\nRental request received!";
            userMsg += "\n\nFrom: " + session.user.name;
            userMsg += "\nRental: $" + registration.price + " AUD and deposit received"; //" $" + value + " AUD";
            userMsg += "\n\nNow let him cut his grass!";

            bot.client.send(registration.userId, userMsg)
        }
    }).catch((err) => {
        Logger.error("Error: " + err);
    });
}

/**
  * Show the list of currently registered lawn mowers.
  */
function findLawnMower(session) {
    bot.client.store.getKey('registrations').then((registrations) => {
        if (registrations == null) {
            sendMessageMainMenu(session, "No lawn mowers have been registered..");
        } else {
            let list = "";
            for (var i = 0; i < registrations.length; i++) {
                list += "Lawn Mower: " + (i + 1);
                list += "\nOwner: " + registrations[i].user;
                list += "\nLocation: " + registrations[i].location;
                list += "\nHour price: $" + registrations[i].price + " AUD";
                list += "\nStatus: " + ((registrations[i].status == 1) ? "RENTED OUT" : "AVAILABLE");
                list += "\n=======================\n\n";
            }
            list += "Select the one you want to rent";

            sendMessageShowKeyboard(session, list);
        }
    }).catch((err) => {
        Logger.error("Error: " + err);
    });
}

/**
  * Renter has selected a lawn mower from the list, so
  * request money (rental and deposit) from him.
  */
function selectedLawnMowerToRent(session) {
    session.set("state", 6);

    bot.client.store.getKey('registrations').then((registrations) => {
        if (registrations == null) {
            sendMessageMainMenu(session, "No lawn mowers have been registered..");
        } else {
            let lm = registrations[session.get("renting") - 1];

            let message = "You requested to rent lawn mower number: " + session.get("renting");
            message += "\nOwner: " + lm.user;
            message += "\nLocation: " + lm.location;
            message += "\nHour price: $" + lm.price + " AUD";
            message += "\n\nPlease pay rental price: $" + lm.price + " AUD + deposit: $10 AUD";

            sendMessage(session, message);

            Fiat.fetch().then((toEth) => {
                session.requestEth(toEth.AUD(Number(10 + Number(lm.price)) / 100), function(session, error, result) {
                    Logger.info("result: " + result);
                    Logger.info("error: " + error);
                });
            })
        }
    }).catch((err) => {
      Logger.error("Error: " + err);
    });
}

/**
  * Registering a lawn mower to rent out. Get price.
  */
function registerLawnMower_getPrice(session) {
    session.set("state", 3);

    sendMessageShowKeyboard(session, "Please enter the hour price in AUD");
}

/**
  * Registering a lawn mower to rent out. Get location.
  */
function registerLawnMower_getLocation(session) {
    session.set("state", 4);

    sendMessageShowKeyboard(session, "Please enter your location (e.g. 25 Bryans Road, Nerang)");
}

/**
  * Insert a new registered lawn mower.
  */
function registerLawnMower_insert(session) {
    // get registrations
    bot.client.store.getKey('registrations').then((registrations) => {
        let name = session.user.name;
        let userId = session.user.token_id;
        var registration = {user: name, userId: userId, renter: 0, price: session.get("price"), location: session.get("location"), status: 0};
        if ((registrations == null) || (registrations == undefined)) {
            registrations = new Array();
        }
        registrations.push(registration);
        bot.client.store.setKey('registrations', registrations);

        session.set("state", 1);

        sendMessageMainMenu(session, "You have registered a lawn mower for rental with the price: " + session.get("price") + " AUD located at: " + session.get("location"));
    }).catch((err) => {
        Logger.error("Error: " + err);
    });
}

/**
  * Welcome message. Shows picture.
  */
function welcome(session) {
    session.set("state", 1);

    sendMessage(session, "Welcome to Lawn Mowers Pro!")

    session.reply(SOFA.Message({
      attachments: [{
            "type": "image",
            "url": "lm.jpg"
      }],
      showKeyboard: false,
    }))

    sendMessageMainMenu(session, "Let's get started!")
}

/**
  * Send message to user without menu, no keyboard
  */
function sendMessage(session, message) {
    session.reply(SOFA.Message({
        body: message,
        showKeyboard: false,
    }));
}

/**
  * Send message to user without menu, showing keyboard.
  */
function sendMessageShowKeyboard(session, message) {
    session.reply(SOFA.Message({
      body: message,
      showKeyboard: true,
  }));
}


/**
  * Send message to user with main menu.
  */
function sendMessageMainMenu(session, message) {
    let controls = [
      {type: 'button', label: 'Find a lawn mower to rent', value: 'find'},
      {type: 'button', label: 'Rent out a lawn mower', value: 'register'}
    ]

    session.reply(SOFA.Message({
        controls: controls,
        body: message,
        showKeyboard: false,
    }))
}
