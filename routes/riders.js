const bcrypt = require('bcrypt');

// In-memory storage for simplicity
const riders = [];
let riderCounter = 1; // To simulate auto-incrementing IDs

async function ridersRoutes(fastify, options) {

  // Register a new rider
  fastify.post('/riders/register', async (request, reply) => {
    /*
        Postman example:
        Method: POST

        URL: http://localhost:8080/riders/register

        Body: (Choose raw and JSON format)

        json

        {
        "username": "john",
        "email": "john@email.com"
        "password": "password123"
        }
    */

    const { username, email, password } = request.body;

    // Validate input
    if (!username || !email || !password) {
      return reply.code(400).send({ error: 'valid usermame, email, and password are required' });
    }

    if (typeof(username) !== 'string' || username.trim().length <= 5) {
      return reply.code(400).send({ error: 'user name must be longer than five characters.' });
    }

    if (typeof(email) !== 'string' || email.trim().length <= 5) {
      return reply.code(400).send({ error: 'email must be longer than five characters.' });
    }

    if (typeof(password) !== 'string' || password.trim().length <= 7) {
      return reply.code(400).send({ error: 'password must be longer than seven characters.' });
    }

    try {
      // Check if the username or email already exists.
      const checkExistsQuery = `
      SELECT riderid
      FROM riders
      WHERE lower(username) = lower($1)
      OR lower(email) = lower($2)
      `;

      const checkExistsResult = await fastify.pg.query(checkExistsQuery, [
        username.trim(),
        email.trim()
      ]);

      if (checkExistsResult.rows.length !== 0) {
        return reply.code(400).send({ error: 'Rider with this username or email address already exists' });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password.trim(), 10);

      // Create new rider and store it in the database
      const addRiderSql = `
      INSERT INTO riders (username, email, password, lastactivitydate, creationdate) 
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING riderid, username, email;
      `;

      // Use parameterized queries to insert the values
      const result = await fastify.pg.query(addRiderSql, [
        username.trim(),
        email.trim(),
        hashedPassword
      ]);
      reply.code(201).send(result.rows[0]);
    } catch (err) {
      console.error('Database error registering user:', err);
      return reply.code(500).send({ error: 'Database error registring user:' });
    }
  });

  // Login a rider
  fastify.post('/riders/login', async (request, reply) => {
    /*
        Method: POST

        URL: http://localhost:8080/riders/login

        Body: (Choose raw and JSON format)

        json

        {
        "name": "john",
        "password": "password123"
        }
    */

    const { username, password } = request.body;

    // Validate input
    if (!username || !password) {
      return reply.code(400).send({ error: 'Username and password are required' });
    }

    // Retrieve the user hashed password
    const retrieveUserInfoQuery = `SELECT riderid, username, password FROM riders WHERE username = $1`;

    try {
      const checkExistsResult = await fastify.pg.query(retrieveUserInfoQuery, [
        username
      ]);

      if (checkExistsResult.rows.length === 0) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      const user = checkExistsResult.rows[0];
      const hashedPassword = user.password;

      // Compare provided password with the stored hashed password
      const isMatch = await bcrypt.compare(password, hashedPassword);

      if (!isMatch) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      // Generate JWT token with 24-hour expiration
      const token = fastify.jwt.sign(
        { riderId: user.riderid, username: user.username },
        { expiresIn: '72h' } // Set the token to expire in 72 hours
      );

      reply.send({ message: 'Login successful', token });
    } catch (err) {
      console.error('Database error logging in user:', err);
      return reply.code(500).send({ error: 'Database error logging in user' });
    }
  });

  // Update rider's password
  fastify.put('/riders/:riderId/password', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    /*
        Method: PUT

        URL: http://localhost:8080/riders/1/password

        Headers:

            Authorization: Bearer <your_jwt_token> (Replace <your_jwt_token> with the actual token you received from the login step)
            Content-Type: application/json

        Body: (Choose raw and JSON format)

        json

        {
        "oldPassword": "password123",
        "newPassword": "newpass456"
        }
    */
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { oldPassword, newPassword } = request.body;

    // Validate input
    if (!oldPassword || !newPassword) {
      return reply.code(400).send({ error: 'Old and new passwords are required' });
    }

    if (typeof(oldPassword) !== 'string' || typeof(newPassword) !== 'string') {
      return reply.code(400).send({ error: 'Username or password are not valid' });
    }

    if (newPassword.trim().length <= 7) {
      return reply.code(400).send({ error: 'new password must be longer than seven characters.' });
    }

    if (newPassword === oldPassword ) {
      return reply.code(400).send({ error: 'new password must not be the same as the old password' });
    }

    // Retrieve the user's hashed password
    const retrieveUserInfoQuery = `SELECT riderid, username, password FROM riders WHERE riderId = $1`;

    try {
      const checkExistsResult = await fastify.pg.query(retrieveUserInfoQuery, [
        riderId
      ]);

      if (checkExistsResult.rows.length === 0) {
        return reply.code(401).send({ error: 'Unable to retrieve rider information' });
      }

      const user = checkExistsResult.rows[0];
      const hashedPassword = user.password;

      // Compare provided password with the stored hashed password
      const isMatch = await bcrypt.compare(oldPassword, hashedPassword);

      if (!isMatch) {
        return reply.code(401).send({ error: 'Invalid old password' });
      }

      // Hash the new password
      const hashedNewPassword = await bcrypt.hash(newPassword.trim(), 10);

      const updatePasswordSql = `
      UPDATE riders
      SET
        password = $1,
        lastactivitydate = CURRENT_TIMESTAMP
      WHERE riderid = $2
      RETURNING riderid;
      `;

      const values = [hashedNewPassword, riderId];

      // Execute the query
      const result = await fastify.pg.query(updatePasswordSql, values);
      if( result.rows.length > 0){
        reply.send({ message: 'Password updated successfully' });
      }
      reply.send({ message: 'Unable to update password' });

    } catch (err) {
      console.error('Database error updating user password:', err);
      return reply.code(500).send({ error: 'Database error updating user password' });
    }
  });
}

module.exports = ridersRoutes;
