// mongo-init.js
db = db.getSiblingDB('conventioner');

db.createCollection('users');
db.createCollection('markets');
db.createCollection('source_data');
db.createCollection('organizations');
db.createCollection('attendance');

db.createCollection('floorplan_templates');
db.floorplan_templates.createIndex({ ownerUserId: 1 });
db.floorplan_templates.createIndex({ organizationId: 1 });
