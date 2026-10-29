-- Split the company's support contact into a phone number and an email address (Alembic 202610310011).
-- The old single field becomes the phone number; nothing is removed.
ALTER TABLE organization_settings ADD COLUMN support_phone VARCHAR(40);
ALTER TABLE organization_settings ADD COLUMN support_email VARCHAR(320);
UPDATE organization_settings SET support_phone = support_contact WHERE support_phone IS NULL AND support_contact IS NOT NULL;
