// db.js
const fp = require('fastify-plugin');
const { Pool, types } = require('pg');

// Use fastify-plugin to share connection across the app
async function dbConnector(fastify, options) {
    // PostgreSQL connection pool

    // Override the parser for INTEGER (OID: 23)
    types.setTypeParser(23, function(val) {
        return parseInt(val, 10);
    });

    // Override the parser for BIGINT (OID: 20)
    types.setTypeParser(20, function(val) {
        return parseInt(val, 10);
    });

    // Override the parser for NUMERIC/DECIMAL (OID: 1700)
    types.setTypeParser(1700, function(val) {
        return parseFloat(val);
    });

    const pool = new Pool({
        user: process.env.OCD_DB_USER,
        host:  process.env.OCD_DB_HOST,
        database: process.env.OCD_DB_NAME,
        password: process.env.OCD_DB_PASSWORD,
        port: process.env.OCD_DB_PORT,
        ssl: {
            rejectUnauthorized: false
        }
    });

    fastify.decorate('pg', pool);

    fastify.addHook('onClose', async (fastify, done) => {
        await pool.end();
    done();
    });
}

module.exports = fp(dbConnector);
