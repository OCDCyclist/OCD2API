// db.js
const fp = require('fastify-plugin');
const { Pool } = require('pg');

// Use fastify-plugin to share connection across the app
async function dbConnector(fastify, options) {
    // PostgreSQL connection pool
    const pool = new Pool({
        user: process.env.OCD_DB_USER,
        host:  process.env.OCD_DB_HOST,
        database: process.env.OCD_DB_NAME,
        password: process.env.OCD_DB_PASSWORD,
        port: process.env.OCD_DB_PORT,
    });

    fastify.decorate('pg', pool);

    fastify.addHook('onClose', async (fastify, done) => {
        await pool.end();
    done();
    });
}

module.exports = fp(dbConnector);
