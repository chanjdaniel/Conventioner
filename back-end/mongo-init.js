// mongo-init.js
db = db.getSiblingDB('conventioner');

db.createCollection('users');
db.createCollection('markets');
db.createCollection('source_data');
db.createCollection('organizations');
db.createCollection('attendance');

// Applications are stored snake_case (see back-end/api/applications.py); the market
// foreign key is market_id, which the D9 application-form lock counts on.
db.createCollection('applications');
db.applications.createIndex({ market_id: 1 });

db.createCollection('floorplan_templates');
db.floorplan_templates.createIndex({ ownerUserId: 1 });
db.floorplan_templates.createIndex({ organizationId: 1 });
