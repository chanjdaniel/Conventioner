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

// The app refuses to boot unless the market-key migration is recorded as applied (see
// back-end/market_documents.py). This database is brand new and holds no market documents, so
// there is nothing under the legacy snake_case keys and the migration is applied vacuously.
db.createCollection('schema_migrations');
db.schema_migrations.updateOne(
  { _id: 'market_document_keys' },
  { $set: { appliedAt: new Date().toISOString() } },
  { upsert: true },
);
