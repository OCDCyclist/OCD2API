const { isRiderId, isFastify, isLocationId, isAssignmentId, isValidTagArray } = require("../utility/general");

const getTags = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `Select name from tags where riderid = $1 order by name;`;
    const params = [riderId];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);

        if (rows.length === 0) {
            return [];
        }

        return rows;
    } catch (err) {
        throw new Error(`Database error getTags with riderId ${riderId}: ${error.message}`);//th
    }
}

const addTag = async (fastify, riderId, name, description) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if( typeof(name) !== 'string' || name.trim().length === 0 || name.trim().length > 30){
        throw new TypeError("Tag name must have at least one non-blank character and 30 characters or less");
    }

    if( typeof(description) !== 'string' || description.trim().length === 0 || description.trim().length > 255){
        throw new TypeError("Tag description must have at least one non-blank character and fewer than 255 characters");
    }

    try{
        return await fastify.pg.query(`
            INSERT INTO tags (
                riderid,
                name,
                description
            )
            VALUES ($1, $2, $3)
            ON CONFLICT (riderid, name)
            DO UPDATE SET
                description = EXCLUDED.description
            RETURNING tagid, riderid, name, description;
                `,  [
                riderId,
                name,
                description
                ]
        );
    }
    catch(error){
        throw new Error(`Database error addTag for riderId ${riderId}: ${error.message}`);//th
    }
}

const removeTag = async (fastify, riderId, name) => {
    // Parameter validation
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if (!isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 30) {
        throw new TypeError("Tag name must have at least one non-blank character and 30 characters or less");
    }

    try {
        // Execute the delete operation
        const result = await fastify.pg.query(
            `DELETE FROM tags WHERE riderid = $1 AND name = $2 RETURNING *;`,
            [riderId, name]
        );

        // Check if any rows were deleted
        if (result.rowCount === 0) {
            return {
                statusCode: 404,
                message: "Tag not found for deletion",
                details: { riderId, name }
            };
        }

        // Successfully deleted
        return {
            statusCode: 200,
            message: "Tag deleted successfully",
            details: result.rows[0]  // Return the deleted tag details
        };

    } catch (error) {
        // Handle database errors
        throw new Error(`Database error in removeTag for riderId ${riderId}: ${error.message}`);
    }
};

const assignTags = async (fastify, riderId, locationId, assignmentId, tags) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if (!isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isLocationId(locationId)) {
        throw new TypeError("locationId must be an integer");
    }

    if (!isAssignmentId(assignmentId)) {
        throw new TypeError("assignmentId must be an integer");
    }

    if (!isValidTagArray(tags)) {
        throw new TypeError("One or more tag names are invalid.");
    }

    try{
        const result = await fastify.pg.query(
            `SELECT * FROM assign_tags_to_location($1, $2, $3, $4::text[])`,
            [riderId, locationId, assignmentId, tags]
        );
        return result;
    }
    catch(error){
        throw new Error(`Database error assigning tags for riderId ${riderId} at location ${locationId}: ${error.message}`);//th
    }
}

module.exports = {
    getTags,
    addTag,
    removeTag,
    assignTags,
};