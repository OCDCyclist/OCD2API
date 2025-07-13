const { DateTime } = require('luxon'); // Add Luxon for date parsing
const { getTags, addTag, removeTag, assignTags} = require('../db/dbTagQueries');
 const { upsertWeight, getWeightTrackerData, getWeightPeriodData, getRiderPowerCurve, calculatePowerCurveMultiple } = require('../db/dbQueries');
const {isRiderId, isLocationId, isAssignmentId, isValidTagArray} = require('../utility/general')

async function userRoutes(fastify, options) {
  // Define the user routes

  fastify.post('/addWeight',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const {
      date,
      weight,
      bodyfatfraction,
      bodyh2ofraction,
    } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    // Input validation
    if (
      !date ||
      weight == null || bodyfatfraction == null || bodyh2ofraction == null
    ) {
      return reply.status(400).send({ error: 'Missing one or more required fields' });
    }

    // Validate the datetime string (YYYY-MM-DD HH:MM:SS)
    const parsedDate = DateTime.fromFormat(date, 'yyyy-MM-dd');
    if (!parsedDate.isValid) {
      return reply.status(400).send({ error: 'Invalid date format (expected YYYY-MM-DD)' });
    }

    // Convert to ISO format for PostgreSQL
    const isoDate = parsedDate.toISO();

    // Validate numerical fields
    const numericFields = { weight, bodyfatfraction, bodyh2ofraction};
    for (const [field, value] of Object.entries(numericFields)) {
      if (value < 0 || isNaN(value)) {
          return reply.status(400).send({ error: `Invalid value for numeric ${field}` });
      }
    }

    try {
      const weightUpdated = await upsertWeight(fastify, riderId, date, weight, bodyfatfraction, bodyh2ofraction);

      // Return the newly inserted weight data
      reply.status(200).send(weightUpdated.rows.length > 0 ? weightUpdated.rows[0] : null);

      // After successfully inserting or updating the weight, update cummulative weights.
      setImmediate(async () => {
        try {
          const updateCummulativesQuery = 'CALL public.update_riderweight_avg($1)';
          await fastify.pg.query(updateCummulativesQuery, [riderId]);
        } catch (updateError) {
          console.error('Error updating cummulatives:', updateError);
          // More error handling later.
        }
      });
    } catch (error) {
        console.error('Error inserting or updating new weight:', error);
        reply.status(500).send({ error: 'An error occurred while inserting or updating the weight measurement' });
    }
  });

  fastify.get('/weighttracker',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getWeightTrackerData(fastify, riderId);

      // If no rider weight tracking is found, return an empty object
      if (result.rows.length === 0) {
        return reply.code(200).send({});
      }

      // Send the rider weight tracker data
      return reply.code(200).send(result.rows[0]);

    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/weight/:period',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { period } = request.params;

    const rideridtouse = parseInt(riderId, 10);
    if (isNaN(rideridtouse)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const periodToUse =  (typeof(period) === 'string') ?  period.toLowerCase().trim() :'month';

    try {
      const rows = await getWeightPeriodData(fastify, rideridtouse, periodToUse);
      return reply.code(200).send(rows);

    } catch (err) {
      console.error('Database error getWeightPeriodData:', err);
      return reply.code(500).send({ error: 'Database error getWeightPeriodData' });
    }
  });

  fastify.get('/bikes',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    let query = `Select bikeid, bikename, stravaname, isdefault from bikes where riderid = $1 and retired = 0;`;
    const params = [id]; // Array to store query parameters (starting with riderId)

    try {
      const { rows } = await fastify.pg.query(query, params);

      // If no bikes are found, return an empty array
      if (rows.length === 0) {
        return reply.code(200).send([]);
      }

      // Send the filtered rides
      return reply.code(200).send(rows);

    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/user/tags',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const tags = await getTags(fastify, riderId);
      return reply.code(200).send(tags);

    } catch (error) {
      console.error(`Error retrieving tags for riderid ${riderId}: `, error);
      return reply.code(500).send({ error: `Error retrieving tags for riderid ${riderId}: ${error.message}}` });
    }
  });

  fastify.post('/user/addTag',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const {
      name,
      description
    } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    // Input validation
    if (
      name === null || description === null
    ) {
      return reply.status(400).send({ error: 'Missing one or more required fields' });
    }

    const invalidItems = [];
    // Validate the name is populated and description is at least a blank string
    if ( typeof(name) !== 'string' || name.trim().length === 0 || name.trim().length > 30) {
      invalidItems.push('Please provide a valid tag name')
    }
    if ( typeof(description) !== 'string' || description.trim().length > 255 ) {
      invalidItems.push('Please provide a description shorter than 255 characters or blank if not required')
    }

    if(invalidItems.length > 0){
      return reply.status(400).send({ error: invalidItems.join(', ') });
    }

    try {
      const tag = await addTag(fastify, riderId, name, description);
      return reply.code(200).send(tag.rows.length > 0 ? tag.rows[0] : null);

    } catch (error) {
      console.error(`Error adding tag for riderid ${riderId}: `, error);
      return reply.code(500).send({ error: `Error adding tag for riderid ${riderId}: ${error.message}` });
    }

  });

  fastify.post('/user/saveTagAssignments',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const {
      locationId,
      assignmentId,
      tags
    } = request.body;

    if (!isRiderId(riderId)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    if (!isLocationId(locationId)) {
      return reply.code(400).send({ error: 'Invalid or missing locationId' });
    }

    if (!isAssignmentId(assignmentId)) {
      return reply.code(400).send({ error: 'Invalid or missing locationId' });
    }

    if (!isValidTagArray(tags)) {
      return reply.code(400).send({ error: 'Tags must be an array of strings' });
    }

    try {
      const tagsAdded = await assignTags(fastify, riderId, locationId, assignmentId, tags);
      return reply.code(200).send(tagsAdded.rows.length > 0 ? tagsAdded.rows : null);
    } catch (error) {
        console.error(`Error adding tag for riderid ${riderId}: `, error);
        return reply.code(500).send({ error: `Error adding tag for riderid ${riderId}: ${error.message}` });
    }
  });

  fastify.delete('/user/removeTag',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const {
      name
    } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const invalidItems = [];
    // Validate the name is populated.
    if ( typeof(name) !== 'string' || name.trim().length === 0 || name.trim().length > 30) {
      invalidItems.push('Please provide a valid tag name that you want to delete')
    }

    if(invalidItems.length > 0){
      return reply.status(400).send({ error: invalidItems.join(', ') });
    }

    try {
      const result = await removeTag(fastify, riderId, name);

      return reply.code(200).send(result);

    } catch (error) {
      console.error(`Error adding tag for riderid ${riderId}: `, error);
      return reply.code(500).send({ error: `Error adding tag for riderid ${riderId}: ${error.message}` });
    }

  });

  fastify.get('/user/zones',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    let query = `Select zonetype, zonevalues from riderzones where riderid = $1;`
    const params = [id];

    try {
      const { rows } = await fastify.pg.query(query, params);

      // If no zones are found, return an empty array
      if (rows.length === 0) {
        return reply.code(200).send([]);
      }

      // Send the filtered rides
      return reply.code(200).send(rows);

    } catch (err) {
      console.error('Database error retrieving zones:', err);
      return reply.code(500).send({ error: 'Database error retrieving zones' });
    }
  });

  fastify.get('/user/powercurve',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getRiderPowerCurve(fastify, id);
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error retrieving powercurve:', err);
      return reply.code(500).send({ error: 'Database error retrieving powercurve' });
    }
  });

  fastify.get('/user/powercurve/:year',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { year } = request.params;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const yearToRefresh = parseInt(year, 10);
    if (isNaN(yearToRefresh) || yearToRefresh < 2000 || yearToRefresh > 2100) {
      return reply.code(400).send({ error: 'Invalid or missing year' });
    }

    let query = `
        SELECT
            rideid
        FROM
            rides
        WHERE
            riderid = $1
            and EXTRACT(YEAR FROM date) = $2
        ORDER BY
            date;
        `;

    const params = [riderId, yearToRefresh];
    const { rows } = await fastify.pg.query(query, params);

    if(!Array.isArray(rows) || rows.length === 0){
      return reply.code(400).send({ error: `No rides exist for year: ${yearToRefresh}` });
    }

    try {
      const rideids = rows.map((ride) => ride.rideid);
      const update = await calculatePowerCurveMultiple(fastify, id, rideids, String(yearToRefresh));
      return reply.code(200).send({ message: `Powercurve for year: ${yearToRefresh} has been updated with ${update}` });
    } catch (err) {
      console.error(`Database error calculating powercurve for year: ${yearToRefresh}`, err);
      return reply.code(500).send({ error: `Database error calculating powercurve for year: ${yearToRefresh}` });
    }
  });

  fastify.get('/user/settings',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    let query = `
        Select
          riderid,
          property,
          date,
          propertyvaluestring,
          propertyvalue
        from
          riderpropertyvalues
        where
          riderid = $1
        order by
          property,
          date;`;

    const params = [riderId];

    try {
      const { rows } = await fastify.pg.query(query, params);
      return reply.code(200).send(rows);
    } catch (err) {
      console.error('Database error retrieving settings:', err);
      return reply.code(500).send({ error: 'Database error retrieving settings' });
    }
  });

  fastify.post('/user/addUserSettingValue', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { property, value } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const insertDate = new Date().toISOString().slice(0, 10);
    const query = `
      INSERT INTO riderpropertyvalues (riderid, property, propertyvalue, propertyvaluestring, date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`;

    let params;
    if (value === null || value === '' || isNaN(Number(value))) {
      params = [riderId, property, null, value, insertDate];
    } else {
      params = [riderId, property, Number(value), null, insertDate];
    }

    try {
      const { rows } = await fastify.pg.query(query, params);
      return rows.length > 0 ? reply.code(200).send(rows[0]) :  null;
    } catch (err) {
      console.error('Database error addUserSettingValue:', err);
      return reply.code(500).send({ error: 'Database error addUserSettingValue' });
    }
  });

  fastify.get('/user/goals',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    let query = `
      Select
        ridergoalid,
        goalid,
        case when goalid = 0 then 'distance'  when goalid = 1 then 'time' else 'unknown' end as type,
        week,
        month,
        year
      from
        ridergoals
      where
        riderid = $1
      order by
        goalid;
    `;

    const params = [riderId];

    try {
      const { rows } = await fastify.pg.query(query, params);
      return reply.code(200).send(rows);
    } catch (err) {
      console.error('Database error retrieving goals:', err);
      return reply.code(500).send({ error: 'Database error retrieving goals' });
    }
  });

  fastify.post('/user/addUpdateGoal', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const {
      ridergoalid,
      goalid,
      week,
      month,
      year
    } = request.body;

    if( typeof goalid !== 'number' || goalid < 0) {
      return reply.code(400).send({ error: 'Invalid goalid' });
    }

    if( typeof week !== 'number' || week < 0) {
      return reply.code(400).send({ error: 'Invalid week value' });
    }

    if( typeof month !== 'number' || month < 0) {
      return reply.code(400).send({ error: 'Invalid month value' });
    }

    if( typeof year !== 'number' || year < 0) {
      return reply.code(400).send({ error: 'Invalid year value' });
    }

    const client = await fastify.pg.connect();
    try {
      await client.query('BEGIN');

      let result;
      if (ridergoalid > 0) {
        // Update existing
        result = await client.query(
          `UPDATE ridergoals
          SET goalid = $2, week = $3, month = $4, year = $5
          WHERE ridergoalid = $1 AND riderid = $6
          RETURNING *`,
          [ridergoalid, goalid, week, month, year, riderId]
        );
      } else {
        // Insert new
        result = await client.query(
          `INSERT INTO ridergoals ([goalid, week, month, year, riderId)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *`,
          [goalid, week, month, year, riderId]
        );
      }

      await client.query('COMMIT');
      return reply.send(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to upsert ridergoals' });
    } finally {
      client.release();
    }
  });
}

module.exports = userRoutes;
