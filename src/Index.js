/*jslint es6 */
"use strict";
const App = require('express')();
const BodyParser = require('body-parser');
const Sequelize = require('sequelize');
const Uuid = require('uuid/v4');

const API_VERSION = 1;

console.log('Loading parameters...');
if (process.env.NODE_ENV !== 'production') {
    const env = require('dotenv').config();
    if (env.error) {
        console.info("Error while loading environment variables: ", env);
    }
}
const params = {
    db_dialect: process.env.DB_DIALECT || "postgres",
    db_host: process.env.DB_HOST || "localhost",
    db_port: process.env.DB_PORT || "5432",
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
App.post(`/api/v${API_VERSION}/kvasir/sonarqube`, function(req, res) {
    console.info("Received request for SonarQube metrics of %s project", req.body.projectName);
    updateQualityGates(req.body).then(function(statusCode) {
        res.status(statusCode).send();
    }).catch(function(error) {
        //TODO: Improve this error handler
        res.status(422).send(error);
    });
});

/**
 * Insert or update new metrics of a project
 * @param {*} qualityGates
 */
async function updateQualityGates(qualityGates) {
    let result = validateSchema(qualityGates);
    if (result.isValid) {
        //recover projectId based on projectName
        let project = await Project.findOne({ where: { name: qualityGates.projectName } });
        if (project) {
            //Find the measure if it was already saved
            for (let i = 0; i < qualityGates.conditions.length; i++) {
                let measure = await Measure.findOne({
                    where: {
                        metric: qualityGates.conditions[i].metric,
                        projectId: project.id
                    }
                });
                //Use the same id or generate a new one
                let id = measure ? measure.id : Uuid();
                //Generate an object that will be save or update on database
                let obj = {
                    id: id,
                    metric: qualityGates.conditions[i].metric,
                    status: qualityGates.conditions[i].level,
                    warningvalue: qualityGates.conditions[i].warning,
                    errorvalue: qualityGates.conditions[i].error,
                    actualvalue: qualityGates.conditions[i].actual,
                    projectId: project.id
                };
                //If measure already exists, update it. Otherwise, create it.
                if (measure) {
                    await measure.update(obj);
                    console.info("Updated metric %s of project %s", obj.metric, qualityGates.projectName);
                    return 200;
                } else {
                    await Measure.create(obj);
                    console.info("Created metric %s for project %s", obj.metric, qualityGates.projectName);
                    return 201;
                }
            }
        } else {
            //TODO: Deal with this properly.
            throw new Exception("Project name not found!");
        }
    } else {
        //TODO: Deal with this properly.
        throw new Exception("Invalid JSON structure!");
    }
};

/**
 * Logic of validate is incomplete yet
 * @param {*} body
 */
function validateSchema(body) {
    return { isValid: true };
}

/**
 * Logic to save entities (E2E)
 * TODO: Update the behavior to meet the new entity mapping
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
let Product;
let Project;
let Measure;
let Scenario;
let Step;
let Test;

let sequelize;

async function prepareDatabase() {
    //Try to connect to the database
    sequelize = new Sequelize(params.db_name, params.db_user, params.db_password, {
        host: params.db_host,
        port: params.db_port,
        dialect: params.db_dialect,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        },
        logging: false,
        define: {
            timestamps: true,
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
        Product = sequelize.define('product', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.UUID
            },
            name: {
                type: Sequelize.STRING(40),
                allowNull: false
            }
        });
        Project = sequelize.define('project', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.UUID
            },
            name: {
                type: Sequelize.STRING(80),
                allowNull: false
            },
            image: {
                type: Sequelize.STRING(80),
                allowNull: false
            }
        });
        Project.belongsToMany(Product, { through: 'productproject' });

        /**
         * Quality Gates structure
         */
        Measure = sequelize.define('measure', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.UUID
            },
            metric: {
                type: Sequelize.STRING(80),
                allowNull: false
            },
            status: {
                type: Sequelize.STRING(10),
                allowNull: false
            },
            warningvalue: {
                type: Sequelize.FLOAT,
                allowNull: true
            },
            errorvalue: {
                type: Sequelize.FLOAT,
                allowNull: true
            },
            actualvalue: {
                type: Sequelize.FLOAT,
                allowNull: true
            }
        });
        Project.hasMany(Measure);
        Measure.belongsTo(Project);

        /**
         * End To End structure
         */
        Scenario = sequelize.define('scenario', {
            id: {
                type: Sequelize.UUID,
                primaryKey: true
            },
            environment: {
                type: Sequelize.STRING(20),
                allowNull: false,
                isIn: [
                    ['web', 'android', 'ios']
                ],
            },
            description: {
                type: Sequelize.STRING(4000),
                allowNull: false
            },
            executedat: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.NOW
            }
        });
        Test = sequelize.define('testcase', {
            id: {
                type: Sequelize.UUID,
                primaryKey: true
            },
            description: {
                type: Sequelize.STRING(255),
                allowNull: false
            }
        });
        Step = sequelize.define('step', {
            id: {
                type: Sequelize.UUID,
                primaryKey: true
            },
            description: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            status: {
                type: Sequelize.STRING,
                validate: {
                    isIn: [
                        ['passed', 'failed', 'skipped']
                    ],
                }
            },
            duration: {
                type: Sequelize.BIGINT,
                allowNull: true
            },
            errormessage: {
                type: Sequelize.STRING(4000),
                allowNull: true
            }
        });
        Test.hasMany(Step);
        Step.belongsTo(Test);
        Scenario.hasMany(Test);
        Test.belongsTo(Scenario);
        Project.hasMany(Scenario);
        Scenario.belongsTo(Project);
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