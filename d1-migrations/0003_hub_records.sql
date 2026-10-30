-- The shared record table behind the Operations pages (contracts, samples, delivery notes, staff, custom sections...).
CREATE TABLE hub_records (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL REFERENCES organizations (id),
    collection VARCHAR(40) NOT NULL,
    parent_id VARCHAR(36),
    period VARCHAR(10),
    data JSON NOT NULL,
    created_by VARCHAR(36),
    updated_by VARCHAR(36),
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    deleted_at VARCHAR(40)
);
CREATE INDEX ix_hub_records_organization_id ON hub_records (organization_id);
CREATE INDEX ix_hub_records_deleted_at ON hub_records (deleted_at);
CREATE INDEX ix_hub_records_collection ON hub_records (organization_id, collection, deleted_at);
CREATE INDEX ix_hub_records_parent ON hub_records (organization_id, collection, parent_id);
CREATE INDEX ix_hub_records_period ON hub_records (organization_id, collection, period);
