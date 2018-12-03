const App = require('express')();
const BodyParser = require('body-parser');
const Sequelize = require('sequelize');

const API_VERSION = 1;

console.log('Loading parameters...');
if (process.env.NODE_ENV !== 'production') {
    const result = require('dotenv').config();
    if (result.error) {
        console.info("Error while loading environment variables: ", result);
    }
};
const params = {
    db_dialect: process.env.DB_DIALECT || "postgres",
    db_host: process.env.DB_HOST || "localhost",
    db_name: process.env.DB_NAME || "gjallarhorn",
    db_password: process.env.DB_PASSWORD || "postgres",
    db_user: process.env.DB_USER || "postgres",
    server_port: process.env.SERVER_PORT || 3000
};
console.log('Parameters were loaded successfully!');

/**
 * Define API's behaviour
 */
App.use(BodyParser.json());
App.post(`/api/v${API_VERSION}/test`, function (req, res) {
    console.log("Request received!");
    saveEntities(req.body).then(() => {
        res.status(201).send();
    }).catch((error) => {
        res.status(422).send(error);
    });
});

/**
 * Logic to save entities
 */
async function saveEntities(scenarios) {
    let transaction;
    try {
        transaction = await sequelize.transaction();
        for (let i = 0; i < scenarios.length; i++) {
            let scenario = await Scenario.create(scenarios[i], { transaction });
            for (let j = 0; j < scenarios[i].tests.length; j++) {
                let test = await Test.create(scenarios[i].tests[j], { transaction });
                for (let k = 0; k < scenarios[i].tests[j].steps.length; k++) {
                    let step = await Step.create(scenarios[i].tests[j].steps[k], { transaction });
                    await test.addStep(step, { transaction });
                };
                await scenario.addTest(test, { transaction });
            };
        };
        await transaction.commit();
    } catch (error) {
        console.error('Error to save values on database: ' + error);
        await transaction.rollback();
        throw error;
    };
};

/**
 * Create database connection and synchronize models
 */
let Scenario;
let Step;
let Test;
let sequelize;

async function prepareDatabase() {
    //Try to connect to the database
    sequelize = new Sequelize(params.db_name, params.db_user, params.db_password, {
        host: params.db_host,
        dialect: params.db_dialect,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        },
        logging: false,
        define: {
            underscored: true,
            timestamps: false,
            paranoid: true,
            freezeTableName: true
        }
    });
    try {
        console.log('Initiating connection to the database...');
        await sequelize.authenticate();
        console.log('Connection to the database has been established successfully!');
    } catch (error) {
        console.error('Unable to connect to the database: ');
        throw error;
    };
    //Define entities and relationships
    try {
        //Define the entities
        Scenario = sequelize.define('scenario', {
            id: {
                type: Sequelize.BIGINT,
                primaryKey: true,
                autoIncrement: true,
            },
            project: {
                type: Sequelize.STRING(20),
                allowNull: false
            },
            environment: {
                type: Sequelize.STRING(20),
                allowNull: false
            },
            description: {
                type: Sequelize.STRING(4000),
                allowNull: false
            },
            executed_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.NOW
            }
        });
        Test = sequelize.define('test', {
            id: {
                type: Sequelize.BIGINT,
                primaryKey: true,
                autoIncrement: true,
            },
            description: {
                type: Sequelize.STRING(255),
                allowNull: false
            }
        });
        Step = sequelize.define('step', {
            id: {
                type: Sequelize.BIGINT,
                primaryKey: true,
                autoIncrement: true,
            },
            description: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            status: {
                type: Sequelize.STRING,
                validate: {
                    isIn: [['passed', 'failed', 'skipped']],
                }
            },
            duration: {
                type: Sequelize.BIGINT,
                allowNull: true
            },
            error_message: {
                type: Sequelize.STRING(4000),
                allowNull: true
            }
        });
        //Define the relationships
        Test.hasMany(Step);
        Step.belongsTo(Test);
        Scenario.hasMany(Test);
        Test.belongsTo(Scenario);
    } catch (error) {
        console.error('Error during model definition: ');
        sequelize.close();
        throw error;
    };

    //Synchronized entities with the database
    try {
        console.log('Initializing database sincronization...');
        await sequelize.sync();
        console.log('Database sincronizhed successfully!');
    } catch (error) {
        console.error('Error during synchronization: ');
        sequelize.close();
        throw error;
    };
};
prepareDatabase().then(() => {
    /**
    * Start the server
    */
    console.log('Starting server...');
    try {
        App.listen(params.server_port);
        console.log("Server running on port " + params.server_port);
    } catch (error) {
        console.error('Error during server start: ' + error);
        process.exitCode = 1;
    };
}).catch((error) => {
    console.log(error);
    process.exitCode = 1;
});