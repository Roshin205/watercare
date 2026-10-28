-- WaterCare schema for Cloudflare D1.
-- Generated from the Flask app's migrations (Alembic head 202610300010) so D1 matches the local SQLite database.
-- Apply with: npx wrangler d1 migrations apply watercare --remote

CREATE TABLE organizations (
	id VARCHAR(36) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE users (
	id VARCHAR(36) NOT NULL, 
	email VARCHAR(320) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	full_name VARCHAR(255), 
	is_active BOOLEAN NOT NULL, 
	access_key_hash VARCHAR(255), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE organization_memberships (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	role VARCHAR(30) NOT NULL, 
	status VARCHAR(30) NOT NULL, 
	created_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (organization_id, user_id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE organization_settings (
	organization_id VARCHAR(36) NOT NULL, 
	name VARCHAR(255), 
	support_contact VARCHAR(255), 
	time_zone VARCHAR(100) NOT NULL, 
	date_format VARCHAR(40) NOT NULL, 
	time_format VARCHAR(10) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (organization_id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id)
);

CREATE TABLE user_settings (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	appearance VARCHAR(20) NOT NULL, 
	notification_preferences JSON NOT NULL, 
	date_format VARCHAR(40), 
	time_format VARCHAR(10), 
	time_zone VARCHAR(100), 
	updated_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (organization_id, user_id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE clients (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	organization_name VARCHAR(255), 
	contact_person VARCHAR(255), 
	phone VARCHAR(60), 
	email VARCHAR(320), 
	address TEXT, 
	category VARCHAR(100), 
	notes TEXT, 
	is_active BOOLEAN NOT NULL, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id)
);

CREATE TABLE engineers (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36), 
	engineer_code VARCHAR(50), 
	full_name VARCHAR(255) NOT NULL, 
	email VARCHAR(320), 
	phone VARCHAR(60), 
	specialization VARCHAR(255), 
	availability VARCHAR(255), 
	is_active BOOLEAN NOT NULL, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE uploaded_documents (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	related_type VARCHAR(40) NOT NULL, 
	related_id VARCHAR(36) NOT NULL, 
	original_filename VARCHAR(255) NOT NULL, 
	image_type VARCHAR(10), 
	storage_path TEXT NOT NULL, 
	mime_type VARCHAR(150) NOT NULL, 
	file_size INTEGER NOT NULL, 
	uploaded_by VARCHAR(36), 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	UNIQUE (storage_path), 
	FOREIGN KEY(uploaded_by) REFERENCES users (id)
);

CREATE TABLE notifications (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36), 
	title VARCHAR(255) NOT NULL, 
	message TEXT NOT NULL, 
	read_at VARCHAR(40), 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE audit_logs (
	id INTEGER NOT NULL, 
	organization_id VARCHAR(36), 
	actor_id VARCHAR(36), 
	table_name VARCHAR(100) NOT NULL, 
	record_id VARCHAR(100), 
	action VARCHAR(40) NOT NULL, 
	old_data JSON, 
	new_data JSON, 
	created_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(actor_id) REFERENCES users (id)
);

CREATE TABLE certificate_templates (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	service VARCHAR(120) NOT NULL, 
	original_filename VARCHAR(255) NOT NULL, 
	file_type VARCHAR(8) NOT NULL, 
	storage_path VARCHAR(500) NOT NULL, 
	file_size INTEGER NOT NULL, 
	tags JSON, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id)
);

CREATE TABLE services (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	description TEXT, 
	certificate_text VARCHAR(300), 
	validity_months INTEGER, 
	is_active BOOLEAN NOT NULL, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id)
);

CREATE TABLE projects (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	client_id VARCHAR(36) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	service VARCHAR(40), 
	client_name VARCHAR(255), 
	so_no INTEGER, 
	contract_period VARCHAR(10), 
	system_details TEXT, 
	engineer_name VARCHAR(255), 
	engineer_visit VARCHAR(20), 
	engineer_visit_custom_date VARCHAR(10), 
	microbiology VARCHAR(3), 
	microbiology_frequency VARCHAR(20), 
	microbiology_custom_date VARCHAR(10), 
	legionella VARCHAR(3), 
	legionella_frequency VARCHAR(20), 
	legionella_custom_date VARCHAR(10), 
	category VARCHAR(100), 
	location TEXT, 
	latitude FLOAT, 
	longitude FLOAT, 
	description TEXT, 
	start_date VARCHAR(10), 
	scheduled_date VARCHAR(10), 
	scheduled_time VARCHAR(16), 
	end_date VARCHAR(10), 
	visit_time VARCHAR(16), 
	status VARCHAR(40) NOT NULL, 
	notes TEXT, 
	completion_status VARCHAR(40), 
	completion_date VARCHAR(10), 
	completion_engineer_name VARCHAR(320), 
	expected_duration INTEGER, 
	completed_duration INTEGER, 
	additional_duration INTEGER, 
	invoice_number VARCHAR(100), 
	approval_status VARCHAR(40), 
	rejection_reason TEXT, 
	priority_date VARCHAR(10), 
	priority_rank FLOAT, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), start_time VARCHAR(16), end_time VARCHAR(16), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(client_id) REFERENCES clients (id)
);

CREATE TABLE cleaning_records (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	client_id VARCHAR(36) NOT NULL, 
	engineer_id VARCHAR(36), 
	site_name VARCHAR(255), 
	tank_identification VARCHAR(255), 
	tank_type VARCHAR(100), 
	capacity FLOAT, 
	location TEXT, 
	cleaning_date VARCHAR(10) NOT NULL, 
	cleaning_time VARCHAR(16), 
	procedure TEXT, 
	materials_used TEXT, 
	observations TEXT, 
	status VARCHAR(40) NOT NULL, 
	next_recommended_date VARCHAR(10), 
	notes TEXT, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(client_id) REFERENCES clients (id), 
	FOREIGN KEY(engineer_id) REFERENCES engineers (id)
);

CREATE TABLE project_engineers (
	organization_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36) NOT NULL, 
	engineer_id VARCHAR(36) NOT NULL, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (project_id, engineer_id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id), 
	FOREIGN KEY(engineer_id) REFERENCES engineers (id)
);

CREATE TABLE project_tasks (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36) NOT NULL, 
	engineer_id VARCHAR(36), 
	title VARCHAR(255) NOT NULL, 
	description TEXT, 
	scheduled_date VARCHAR(10) NOT NULL, 
	scheduled_time VARCHAR(16), 
	location TEXT, 
	status VARCHAR(40) NOT NULL, 
	notes TEXT, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id), 
	FOREIGN KEY(engineer_id) REFERENCES engineers (id)
);

CREATE TABLE water_testing_records (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	client_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36), 
	engineer_id VARCHAR(36), 
	sampling_location TEXT, 
	collection_date VARCHAR(10) NOT NULL, 
	collection_time VARCHAR(16), 
	water_source VARCHAR(255), 
	testing_category VARCHAR(100), 
	sample_identification VARCHAR(255), 
	test_parameters JSON NOT NULL, 
	test_results JSON NOT NULL, 
	reference_limits JSON NOT NULL, 
	interpretation TEXT, 
	laboratory_details TEXT, 
	status VARCHAR(40) NOT NULL, 
	notes TEXT, 
	created_by VARCHAR(36), 
	updated_by VARCHAR(36), 
	created_at VARCHAR(40) NOT NULL, 
	updated_at VARCHAR(40) NOT NULL, 
	deleted_at VARCHAR(40), 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(client_id) REFERENCES clients (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id), 
	FOREIGN KEY(engineer_id) REFERENCES engineers (id)
);

CREATE TABLE approval_history (
	id VARCHAR(36) NOT NULL, 
	organization_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36), 
	task_id VARCHAR(36), 
	reference VARCHAR(600) NOT NULL, 
	previous_status VARCHAR(40) NOT NULL, 
	new_status VARCHAR(40) NOT NULL, 
	action VARCHAR(40) NOT NULL, 
	reason TEXT, 
	actor_id VARCHAR(36), 
	actor_name VARCHAR(320) NOT NULL, 
	created_at VARCHAR(40) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id), 
	FOREIGN KEY(task_id) REFERENCES project_tasks (id), 
	FOREIGN KEY(actor_id) REFERENCES users (id)
);

CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE INDEX ix_organization_memberships_user_id ON organization_memberships (user_id);

CREATE INDEX ix_organization_memberships_organization_id ON organization_memberships (organization_id);

CREATE INDEX ix_user_settings_user_id ON user_settings (user_id);

CREATE INDEX ix_user_settings_organization_id ON user_settings (organization_id);

CREATE INDEX ix_clients_deleted_at ON clients (deleted_at);

CREATE INDEX ix_clients_organization_id ON clients (organization_id);

CREATE INDEX ix_engineers_user_id ON engineers (user_id);

CREATE INDEX ix_engineers_deleted_at ON engineers (deleted_at);

CREATE INDEX ix_engineers_organization_id ON engineers (organization_id);

CREATE UNIQUE INDEX uq_engineers_organization_code ON engineers (organization_id, engineer_code);

CREATE INDEX ix_uploaded_documents_organization_id ON uploaded_documents (organization_id);

CREATE INDEX ix_uploaded_documents_deleted_at ON uploaded_documents (deleted_at);

CREATE INDEX ix_uploaded_documents_related_id ON uploaded_documents (related_id);

CREATE INDEX ix_notifications_user_id ON notifications (user_id);

CREATE INDEX ix_notifications_organization_id ON notifications (organization_id);

CREATE INDEX ix_notifications_deleted_at ON notifications (deleted_at);

CREATE INDEX ix_audit_logs_organization_id ON audit_logs (organization_id);

CREATE INDEX ix_certificate_templates_deleted_at ON certificate_templates (deleted_at);

CREATE INDEX ix_certificate_templates_organization_id ON certificate_templates (organization_id);

CREATE INDEX ix_certificate_templates_service ON certificate_templates (service);

CREATE INDEX ix_services_deleted_at ON services (deleted_at);

CREATE INDEX ix_services_organization_id ON services (organization_id);

CREATE INDEX ix_projects_organization_id ON projects (organization_id);

CREATE INDEX ix_projects_client_id ON projects (client_id);

CREATE INDEX ix_projects_status ON projects (status);

CREATE INDEX ix_projects_scheduled_date ON projects (scheduled_date);

CREATE INDEX ix_projects_deleted_at ON projects (deleted_at);

CREATE INDEX ix_projects_approval_status ON projects (approval_status);

CREATE INDEX ix_cleaning_records_engineer_id ON cleaning_records (engineer_id);

CREATE INDEX ix_cleaning_records_deleted_at ON cleaning_records (deleted_at);

CREATE INDEX ix_cleaning_records_status ON cleaning_records (status);

CREATE INDEX ix_cleaning_records_client_id ON cleaning_records (client_id);

CREATE INDEX ix_cleaning_records_organization_id ON cleaning_records (organization_id);

CREATE INDEX ix_cleaning_records_cleaning_date ON cleaning_records (cleaning_date);

CREATE INDEX ix_project_engineers_organization_id ON project_engineers (organization_id);

CREATE INDEX ix_project_tasks_organization_id ON project_tasks (organization_id);

CREATE INDEX ix_project_tasks_engineer_id ON project_tasks (engineer_id);

CREATE INDEX ix_project_tasks_deleted_at ON project_tasks (deleted_at);

CREATE INDEX ix_project_tasks_project_id ON project_tasks (project_id);

CREATE INDEX ix_project_tasks_status ON project_tasks (status);

CREATE INDEX ix_project_tasks_scheduled_date ON project_tasks (scheduled_date);

CREATE INDEX ix_water_testing_records_project_id ON water_testing_records (project_id);

CREATE INDEX ix_water_testing_records_collection_date ON water_testing_records (collection_date);

CREATE INDEX ix_water_testing_records_status ON water_testing_records (status);

CREATE INDEX ix_water_testing_records_client_id ON water_testing_records (client_id);

CREATE INDEX ix_water_testing_records_deleted_at ON water_testing_records (deleted_at);

CREATE INDEX ix_water_testing_records_organization_id ON water_testing_records (organization_id);

CREATE INDEX ix_water_testing_records_engineer_id ON water_testing_records (engineer_id);

CREATE INDEX ix_approval_history_organization_id ON approval_history (organization_id);

CREATE INDEX ix_approval_history_created_at ON approval_history (created_at);

CREATE INDEX ix_approval_history_project_id ON approval_history (project_id);
