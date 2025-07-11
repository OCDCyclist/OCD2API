const isEmpty = (argument) => {
    if(typeof(argument) !== 'object' || argument == undefined || argument == null){
        return true;
    }
    return false;
};

const isFastify = (fastify) => {
    // Validate the fastify object and pg plugin
    if (!fastify || typeof fastify.pg?.query !== 'function') {
        throw new Error("Invalid 'fastify' object or 'pg' plugin not registered");
    }
    return true;
}

const isIntegerValue = (theValue) =>{
    if (typeof(theValue) !== 'number' || !Number.isInteger(theValue)) {
        return false;
    }
    return true;
}

function isValidNumber(value) {
    return typeof value === 'number' && !isNaN(value);
}

const isRiderId = (riderId) => isIntegerValue(riderId);
const isSegmentId = (segmentId) => isIntegerValue(segmentId);
const isLocationId = (locationId) => isIntegerValue(locationId);
const isAssignmentId = (assignmentId) => isIntegerValue(assignmentId);

const isValidDate = (dateString) => {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
}

/**
 * Checks if every element in an array is a non-blank string up to 30 characters long.
 * @param {string[]} arr - The array to validate.
 * @returns {boolean} - Returns true if all elements pass the validation, otherwise false.
 */
const isValidTagArray = (arr) => {
    return Array.isArray(arr) && arr.every(
        (str) => typeof str === 'string' && str.trim() !== '' && str.length <= 30
    );
}


/**
 * Checks if every element in an array is a non-blank string up to 30 characters long.
 * @param {object[]} data - The array to validate.
 * @returns {boolean} - Returns true if all elements pass the validation, otherwise false.
 */
const isValidRideArray = (data) => {
    return Array.isArray(data) && arr.every(
        (ride) => typeof ride === 'object' && 'rideid' in ride
    );
}

/**
 * Validate each value is a valid year (e.g., 4-digit number)
 * @param {year} data - The year value to validate.
 * @returns {boolean} - Returns true if the year is valid (4-digit number), otherwise false.
 */
const isValidYear = (year) => Number.isInteger(year) && year >= 1000 && year <= 9999;

function logMessage(message) {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    console.log(`${message} at: ${hours}:${minutes}:${seconds}`);
}

const logDetailMessage = (actionMsg, valueTitle,  value) => console.log(`[${new Date().toISOString()}] ${actionMsg} completed for ${valueTitle} ${value}`);

const POWER_CURVE_INTERVALS = [
    1, 2, 5, 10, 15, 20, 30, 45, 60, 120, 180, 240, 300,
    360, 480, 600, 720, 900, 1200, 1500, 1800, 2400, 3000,
    3600, 4500, 5400, 6300, 7200, 9000, 10800, 14400, 18000,
    21600, 25200, 28800, 32400, 36000, 43200
];

const DEFAULT_ZONES = {
    HR: "123,136,152,160,9999",
    Power: "190,215,245,275,310,406,9999",
    Cadence: "60,70,80,90,100"
  };

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return undefined
}

module.exports = { isEmpty, isFastify, isRiderId, isSegmentId, isLocationId, isAssignmentId, isValidDate, isValidTagArray, isValidNumber, isIntegerValue, isValidRideArray, isValidYear, logMessage, logDetailMessage, POWER_CURVE_INTERVALS, DEFAULT_ZONES, parseBoolean };