-- Projects become AMC contracts and engineers become staff profiles; then the tables nothing uses any more are removed.
-- Water testing, tank cleaning, certificate templates, notifications and the old approval history have no replacement data.
INSERT INTO hub_records (id, organization_id, collection, parent_id, period, data, created_by, updated_by, created_at, updated_at)
SELECT p.id, p.organization_id, 'contracts', NULL, NULL,
    json_object(
        'client', COALESCE(p.client_name, c.name, ''), 'client_id', p.client_id, 'site', p.name, 'so', COALESCE(CAST(p.so_no AS TEXT), ''),
        'service', COALESCE(p.service, ''), 'visit_time', COALESCE(p.visit_time, ''), 'engineer', COALESCE(p.engineer_name, ''),
        'start', COALESCE(p.start_date, ''), 'expiry', COALESCE(p.end_date, ''), 'system_details', COALESCE(p.system_details, ''),
        'location', COALESCE(p.location, ''), 'latitude', p.latitude, 'longitude', p.longitude,
        'microbiology', COALESCE(p.microbiology, ''), 'legionella', COALESCE(p.legionella, ''),
        'frequency', CASE WHEN p.engineer_visit IN ('Monthly', 'Quarterly') THEN p.engineer_visit WHEN p.engineer_visit = 'Alternative' THEN 'Bimonthly' ELSE '' END,
        'invoice_no', COALESCE(p.invoice_number, ''), 'invoice', 'Pending', 'report', 'Pending', 'grn', '', 'lab', 'Pending',
        'status', 'Active', 'source', 'AMC',
        'next_due', CASE WHEN p.engineer_visit = 'Custom' THEN COALESCE(p.engineer_visit_custom_date, '') ELSE '' END,
        'schedule', json(CASE WHEN p.engineer_visit = 'Custom' AND p.engineer_visit_custom_date IS NOT NULL
            THEN json_object(substr(p.engineer_visit_custom_date, 1, 7), json_object('status', 'due', 'date', p.engineer_visit_custom_date, 'engineer', COALESCE(p.engineer_name, '')))
            ELSE '{}' END)
    ),
    p.created_by, p.updated_by, p.created_at, p.updated_at
FROM projects p LEFT JOIN clients c ON c.id = p.client_id
WHERE p.deleted_at IS NULL;

INSERT INTO hub_records (id, organization_id, collection, parent_id, period, data, created_by, updated_by, created_at, updated_at)
SELECT e.id, e.organization_id, 'staff', NULL, NULL,
    json_object(
        'name', e.full_name, 'employee_id', COALESCE(e.engineer_code, ''), 'email', COALESCE(e.email, ''), 'mobile', COALESCE(e.phone, ''),
        'specialization', COALESCE(e.specialization, ''), 'availability', COALESCE(e.availability, ''), 'position', 'Engineer',
        'status', CASE WHEN e.is_active THEN 'Active' ELSE 'Resigned' END, 'user_id', e.user_id
    ),
    e.created_by, e.updated_by, e.created_at, e.updated_at
FROM engineers e
WHERE e.deleted_at IS NULL;

DROP TABLE IF EXISTS approval_history;
DROP TABLE IF EXISTS project_engineers;
DROP TABLE IF EXISTS project_tasks;
DROP TABLE IF EXISTS water_testing_records;
DROP TABLE IF EXISTS cleaning_records;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS certificate_templates;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS engineers;
