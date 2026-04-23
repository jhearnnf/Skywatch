// Single source of truth lives in categories.json — shared with the frontend
// (src/pages/Admin.jsx, src/data/mockData.js) to stop the two sides drifting.
const { CATEGORIES, SUBCATEGORIES } = require('./categories.json');

module.exports = { CATEGORIES, SUBCATEGORIES };
