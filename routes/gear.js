const { DateTime } = require('luxon'); // Add Luxon for date parsing
const {isRiderId, isLocationId, isAssignmentId, isValidTagArray} = require('../utility/general')

async function gearRoutes(fastify, options) {
  // Define the gear routes

  fastify.get('/gear/bikes',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    let query = `
      Select
        bikeid,
        bikename,
        brand,
        make,
        isdefault,
        retired,
        stravaname,
        stravaid,
        rides,
        distance,
        hours,
        earliest,
        latest
      From
        get_rider_bikes($1);
    `;
    const params = [id]; // Array to store query parameters (starting with riderId)

    try {
      const { rows } = await fastify.pg.query(query, params);

      // If no bikes are found, return an empty array
      if (rows.length === 0) {
        return reply.code(200).send([]);
      }

      // Send the bike data
      return reply.code(200).send(rows);

    } catch (err) {
      console.error('Database error get_rider_bikes:', err);
      return reply.code(500).send({ error: 'Database error get_rider_bikes' });
    }
  });

  fastify.post('/gear/addUpdateBike', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const {
        bikeid,
        bikename,
        brand,
        make,
        isdefault,
        retired,
        stravaname,
        stravaid
    } = request.body;

    if( typeof bikeid !== 'number' || bikeid < 0) {
      return reply.code(400).send({ error: 'Invalid bikeid' });
    }

    if (typeof bikename !== 'string' || bikename.trim().length === 0) {
      return reply.code(400).send({ error: 'Invalid bikename' });
    }

    if (typeof brand !== 'string') {
      return reply.code(400).send({ error: 'Invalid brand' });
    }

    if (typeof make !== 'string') {
      return reply.code(400).send({ error: 'Invalid make' });
    }

    if (typeof isdefault !== 'boolean') {
      return reply.code(400).send({ error: 'Invalid isdefault value' });
    }

    if (typeof retired !== 'boolean') {
      return reply.code(400).send({ error: 'Invalid retired value' });
    }

    if (stravaname && (typeof stravaname !== 'string')) {
      return reply.code(400).send({ error: 'Invalid stravaname' });
    }

    if (stravaid && (typeof stravaid !== 'string')) {
      return reply.code(400).send({ error: 'Invalid stravaid' });
    }

    const client = await fastify.pg.connect();
    try {
      await client.query('BEGIN');

      if (isdefault === true) {
        // Clear other defaults
        await client.query(
          `UPDATE bikes SET isdefault = 0 WHERE riderid = $1`,
          [riderId]
        );
      }

      let result;
      if (bikeid) {
        // Update existing
        result = await client.query(
          `UPDATE bikes
          SET bikename = $1, brand = $2, make = $3, isdefault = $4,
              retired = $5, stravaname = $6, stravaid = $7
          WHERE bikeid = $8 AND riderid = $9
          RETURNING *`,
          [bikename, brand, make, isdefault ? 1 : 0, retired ? 1 : 0, stravaname, stravaid, bikeid, riderId]
        );
      } else {
        // Insert new
        result = await client.query(
          `INSERT INTO bikes (riderid, bikename, brand, make, isdefault, retired, stravaname, stravaid)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *`,
          [riderId, bikename, brand, make, isdefault ? 1 : 0, retired ? 1 : 0, stravaname, stravaid]
        );
      }

      await client.query('COMMIT');
      return reply.send(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to upsert bike' });
    } finally {
      client.release();
    }
  });
}

module.exports = gearRoutes;
