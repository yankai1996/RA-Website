const Sequelize = require('sequelize');
const config = require('./config');

var sequelize = new Sequelize(
    config.database, 
    config.username, 
    config.password, 
    {
        host: config.host,
        dialect: 'mysql',
        pool: {
            max: 5,
            min: 0,
            idle: 30000
        }
    }
);

// define table 'participants'
var Participant = sequelize.define('participant', {
    id: {
        type: Sequelize.STRING(4),
        allowNull: false,
        primaryKey: true
    },
    pin: {
        type: Sequelize.STRING(4),
        allowNull: false
    },
    payoff: Sequelize.FLOAT(5,2)
}, {
    timestamps: false,
    freezeTableName: true
});

// define table 'games'
var Game = sequelize.define('game', {
    id: {
        type: Sequelize.STRING(20),
        allowNull: false,
        primaryKey: true
    },
    buyer_id: {
        type: Sequelize.STRING(4),
        // references: 'participants',
        // referencesKey: 'id'
    },
    seller_id:{
        type: Sequelize.STRING(4),
        // references: 'participants',
        // referencesKey: 'id'
    },
    alpha: {
        type: Sequelize.FLOAT(3,2),
        allowNull: false
    },
    beta: {
        type: Sequelize.FLOAT(3,2),
        allowNull: false
    },
    gamma: {
        type: Sequelize.FLOAT(3,2),
        allowNull: false
    },
    t: {
        type: Sequelize.INTEGER(4),
        allowNull: false
    },
    w: {
        type: Sequelize.FLOAT(6,2),
        allowNull: false
    },
    exists_2nd_buyer: Sequelize.BOOLEAN
}, {
    timestamps: false,
    freezeTableName: true
});


function init() {
    Game.sync();
    Participant.sync();
}
// init();

exports.Game = Game;
exports.Participant = Participant;

exports.init = init;