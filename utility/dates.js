const dayjs = require('dayjs');

// Utility to round up to the nearest day
const getRoundedCurrentDateISO = () => {
    return dayjs().add(1, 'day').startOf('day').toISOString();
}

// Function to get the date 6 months before a given date
const getSixMonthsEarlier= (date) => {
    return dayjs(date).subtract(6, 'months').startOf('day').toISOString();
}

// Function to get the date 12 months before a given date
const getTwelveMonthsEarlier= (date) => {
    return dayjs(date).subtract(12, 'months').startOf('day').toISOString();
}

module.exports = { getRoundedCurrentDateISO, getSixMonthsEarlier, getTwelveMonthsEarlier };