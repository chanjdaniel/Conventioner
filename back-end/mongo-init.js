// mongo-init.js
db = db.getSiblingDB('conventioner');

db.createCollection('users');

// Every public URL a market appears on - check-in, the application form, applicant sign-in -
// resolves it by the slug of its name, and those endpoints are unauthenticated. The slug is
// stored (Market.slug, a computed field) and indexed so that lookup is one indexed query rather
// than a decode of every market in the collection, driven by anyone who can type a URL.
db.createCollection('markets');
db.markets.createIndex({ slug: 1 }, { name: 'market_slug' });

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

// The app refuses to boot unless the market-document migration is recorded as applied, in both
// its parts (see MARKET_MIGRATION_IDS in back-end/market_documents.py). This database is brand new
// and holds no market documents, so there is nothing under the legacy snake_case keys and nothing
// missing a slug: the migration is applied vacuously, and both markers say so.
db.createCollection('schema_migrations');
['market_document_keys', 'market_slugs'].forEach(function (marker) {
  db.schema_migrations.updateOne(
    { _id: marker },
    { $set: { appliedAt: new Date().toISOString() } },
    { upsert: true },
  );
});
