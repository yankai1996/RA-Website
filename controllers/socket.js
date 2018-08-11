var socketio = require('socket.io');
var Assistant = require('../models/assistant');

const COMMAND = {
    AUTH: "auth",
	PAUSE: "pause",
	RESUME: "resume"
}
const EVENT = {
    COMPLETE: 'complete',
    DECISION: 'decision',
    END_PERIOD: 'end period',
    LEAVE_ROOM: 'leave room',
    LOGIN: 'login',
    LOST_OP: 'lost opponent',
    NEW_GAME: 'new game',
    NEW_PERIOD: 'new period',
    PROPOSE: 'propose',
    READY: 'ready',
    RESULT: 'result',
    SYNC_GAME: 'sync game',
    TEST: 'test',
    WAIT: 'wait opponent',
}


function Instructor(io) {
    this.io = io;
    this.paused = false;
}

Instructor.prototype.pauseAll = function () {
    this.io.emit(COMMAND.PAUSE);
    this.paused = true;
}

Instructor.prototype.resumeAll = function () {
    this.io.emit(COMMAND.RESUME);
    this.paused = false;
}


function Dealer(self, opponent, io) {
    this.self = self;
    this.opponent = opponent;
    this.io = io;
    this.game = {};
    this.period = {};
}

Dealer.prototype.toBuyer = function (event, data) {
    this.io.to(this.game.buyer_id).emit(event, data);
}

Dealer.prototype.toSeller = function (event, data) {
    this.io.to(this.game.seller_id).emit(event, data);
}

Dealer.prototype.toBoth = function (event, data) {
    this.toBuyer(event, data);
    this.toSeller(event, data);
}

// get a new game
Dealer.prototype.newGame = async function () {
    var game = await Assistant.getNewGame(this.self);
    if (!game) {
        this.toBoth(EVENT.COMPLETE, "You have finished all the games.");
    } else {
        this.game = game;
        Assistant.deletePeriods(this.game.id);
        this.io.to(this.opponent).emit(EVENT.SYNC_GAME, this.game);
    }
}

Dealer.prototype.syncGame = function (game) {
    this.game = game;
}

Dealer.prototype.syncPeriod = function (period) {
    this.period = period;
}

// start the game
Dealer.prototype.startGame = async function () {
    var preparationSeconds = 10;
    var gamesLeft = await Assistant.countUnfinishedGames(this.self) - 1;
    this.toBuyer(EVENT.NEW_GAME, {
        alpha: this.game.alpha,
        beta: this.game.beta,
        gamma: this.game.gamma,
        t: this.game.t,
        w: this.game.w,
        isWarmup: this.game.is_warmup,
        role: 'buyer',
        preparationSeconds: preparationSeconds,
        gamesLeft: gamesLeft
    });
    this.toSeller(EVENT.NEW_GAME, {
        alpha: this.game.alpha,
        beta: this.game.beta,
        gamma: this.game.gamma,
        t: this.game.t,
        w: this.game.w,
        isWarmup: this.game.is_warmup,
        role: 'seller',
        preparationSeconds: preparationSeconds,
        gamesLeft: gamesLeft
    });
    setTimeout(() => {
        this.nextPeriod(true);
    }, 1000 * preparationSeconds);
}

// enter the next period
Dealer.prototype.nextPeriod = function (initial = false) {
    // if it has reached the end of the game
    if (!initial && this.period.number == this.game.t) {
        return false;
    }

    var random = Math.random();
    this.toBuyer(EVENT.TEST, random + "<" + this.game.beta + "?");
    var proposerId = random < this.game.beta
        ? this.game.buyer_id 
        : this.game.seller_id;

    this.period = {
        number: initial 
            ? 1
            : this.period.number + 1,
        proposer_id: proposerId,
        proposer_role: proposerId == this.game.buyer_id
            ? 'buyer'
            : 'seller',
        price: null,
        proposed_at: null,
        accepted: false,
        decided_at: null,
        show_up_2nd_buyer: this.game.exists_2nd_buyer && Math.random() < this.game.alpha
    }

    this.toBoth(EVENT.NEW_PERIOD, this.period)
    return true;
}

// send proposal to opponent
Dealer.prototype.propose = function () {
    this.toBoth(EVENT.PROPOSE, this.period);
}

// end one period
Dealer.prototype.endPeriod = async function () {
    this.toBoth(EVENT.DECISION, this.period);
    await Assistant.savePeriod(this.game.id, this.period);
    if (this.period.show_up_2nd_buyer || this.period.accepted || !this.nextPeriod()) {
        this.endGame();
    }
}

// end one game
Dealer.prototype.endGame = async function () {
    var result = await Assistant.endGame(this.game, this.period);
    this.toBuyer(EVENT.RESULT, {
        price: result.price,
        exists2ndBuyer: result.exists2ndBuyer,
        cost: result.cost,
        selfProfit: result.buyerProfit,
        opponentProfit: result.sellerProfit
    });
    this.toSeller(EVENT.RESULT, {
        price: result.price,
        exists2ndBuyer: result.exists2ndBuyer,
        cost: result.cost,
        selfProfit: result.sellerProfit,
        opponentProfit: result.buyerProfit
    });
}


exports.listen = (server) => {
    var io = socketio.listen(server);

    io.sockets.on('connection', (socket) => {

        var self, opponent, dealer, instructor;

        // initialization triggered once login
        socket.emit(EVENT.LOGIN, 'What is your ID?', async (id) => {
            self = id;
            var result = await Assistant.getOpponent(self);
            if (result.opponent) {
                opponent = result.opponent;
                dealer = new Dealer(self, opponent, io);
                socket.emit(EVENT.TEST, "Welcome! " + self + ". Your opponent is " + opponent);
            } else {
                socket.emit(EVENT.TEST, "Welcome! " + self + ". You have no opponent!");
            }
        });

        socket.on(COMMAND.AUTH, () => {
            instructor = new Instructor(io);
        });

        socket.on(COMMAND.PAUSE, () => {
            instructor.pauseAll();
        });

        socket.on(COMMAND.RESUME, () => {
            instructor.resumeAll();
        });


        // received the proposal from the proposer
        socket.on(EVENT.PROPOSE, (period) => {
            dealer.syncPeriod(period);
            dealer.propose();
        });

        // check if the opponent is online
        const opponentIsOnline = () => {
            return opponent && io.sockets.adapter.rooms[opponent];
        }

        // notified that the participant is ready to start the game
        socket.on(EVENT.READY, () => {
            socket.join(self);
            if (!opponentIsOnline()) {
                socket.emit(EVENT.WAIT, "Looking for your opponent...");
            } else {
                dealer.newGame();
            }
        });

        // sync the game from the opponent dealer
        socket.on(EVENT.SYNC_GAME, (game) => {
            dealer.syncGame(game);
            dealer.startGame();
        });

        // received when decision is made or time is out
        socket.on(EVENT.END_PERIOD, (period) => {
            dealer.syncPeriod(period);
            dealer.endPeriod();
        });

        socket.on(EVENT.LEAVE_ROOM, () => {
            socket.leave(self);
        })

        socket.on('disconnect', () => {
            if (opponentIsOnline()) {
                io.to(opponent).emit(EVENT.LOST_OP, "Your opponent is lost!");
            }
        });

    });

    return io;
}
