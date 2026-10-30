// Clients and Services: the two lists every section shares.
(() => {
  const H = window.WolganHub, esc = H.esc;
  let clientState = {}, serviceState = {};
  const request = (path, method, body) => H.app().request(path, { method, body: JSON.stringify(body) });

  function openClient(row) {
    return H.form({
      title: row ? `Edit ${row.name}` : "Add Client", values: row || {},
      fields: [
        { key: "name", label: "Client", required: true }, { key: "organization_name", label: "Organization Name" }, { key: "contact_person", label: "Contact Person" },
        { key: "phone", label: "Phone" }, { key: "email", label: "Email", type: "email" }, { key: "category", label: "Category" },
        { key: "address", label: "Address", type: "textarea", full: true }, { key: "notes", label: "Notes", type: "textarea", full: true },
      ],
      submit: ({ name, organization_name, contact_person, phone, email, category, address, notes }) => request(row ? `/clients/${row.id}` : "/clients", row ? "PATCH" : "POST", { name, organization_name, contact_person, phone, email, category, address, notes }),
    });
  }
  H.openClientForm = openClient;
  H.page("Clients", {
    async render(host) {
      const clients = await H.clients();
      H.toolbar(host, [
        { type: "search", key: "q", placeholder: "Search name, contact, phone, email" },
        { type: "button", label: "＋ Add Client", primary: true, edit: true, onClick: () => openClient().then(saved => { if (saved) H.show("Clients"); }) },
        { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Clients") },
      ], () => paint(), clientState);
      const table = H.table(host, {
        id: "clients", eyebrow: "BUSINESS RECORDS", title: "Clients", empty: "No clients yet.",
        columns: [
          { key: "name", label: "Client", value: row => row.name, html: row => `<a href="#" class="hub-link" data-act="view">${esc(row.name)}</a>` },
          { key: "contact_person", label: "Contact Person" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "category", label: "Category" },
        ],
        actions: [{ key: "view", title: "View" }, { key: "edit", title: "Edit", edit: true }, { key: "archive", title: "Archive", edit: true }],
        on: {
          view: row => H.openClient(row.id),
          edit: row => openClient(row).then(saved => { if (saved) H.show("Clients"); }),
          archive: async row => {
            if (await H.confirm(`Archive ${row.name}? Historical records are retained.`, { action: "Archive" })) {
              try { await H.app().request(`/clients/${row.id}`, { method: "DELETE" }); H.show("Clients"); } catch (error) { H.fail(error); }
            }
          },
        },
      });
      const paint = () => table.show(clients.filter(row => H.matches(clientState.q, [row.name, row.contact_person, row.phone, row.email, row.category, row.address])));
      paint();
    },
  });

  function openService(row) {
    H.form({
      title: row ? `Edit ${row.name}` : "Add Service", values: row ? { ...row, is_active: row.is_active ? "Active" : "Inactive" } : { validity_months: 6, is_active: "Active" },
      fields: [
        { key: "name", label: "Name", required: true }, { key: "validity_months", label: "Valid For (Months)", type: "number", hint: "How long its certificates stay valid." },
        { key: "description", label: "Description", type: "textarea", full: true },
        { key: "certificate_text", label: "Certificate Wording", full: true, hint: "Filled into the certificate when this service is chosen." },
        { key: "is_active", label: "Status", type: "select", options: ["Active", "Inactive"] },
      ],
      submit: ({ name, validity_months, description, certificate_text, is_active }) => request(row ? `/services/${row.id}` : "/services", row ? "PATCH" : "POST", {
        name, description, certificate_text, validity_months: Number(validity_months) || 6, is_active: is_active === "Active",
      }),
    }).then(saved => { if (saved) { H.app().loadServices(); H.show("Services"); } });
  }
  H.page("Services", {
    async render(host) {
      const services = (await H.app().request("/services")).data || [];
      const owner = H.role === "administrator";
      H.toolbar(host, [
        { type: "search", key: "q", placeholder: "Search services" },
        ...(owner ? [{ type: "button", label: "＋ Add Service", primary: true, onClick: () => openService() }] : []),
      ], () => paint(), serviceState);
      const table = H.table(host, {
        id: "services", eyebrow: "BUSINESS RECORDS", title: "Services", empty: "No services yet.",
        columns: [
          { key: "name", label: "Name" }, { key: "description", label: "Description", className: "wrap" }, { key: "certificate_text", label: "Certificate Wording", className: "wrap" },
          { key: "validity_months", label: "Valid For (Months)" }, { key: "is_active", label: "Status", value: row => row.is_active ? "Active" : "Inactive", html: row => H.badge(row.is_active ? "Active" : "Inactive", row.is_active ? "green" : "grey") },
        ],
        actions: owner ? [{ key: "edit", title: "Edit" }, { key: "archive", title: "Archive" }] : [],
        on: {
          edit: openService,
          archive: async row => {
            if (await H.confirm(`Archive ${row.name}?`, { action: "Archive" })) {
              try { await H.app().request(`/services/${row.id}`, { method: "DELETE" }); H.app().loadServices(); H.show("Services"); } catch (error) { H.fail(error); }
            }
          },
        },
      });
      const paint = () => table.show(services.filter(row => H.matches(serviceState.q, [row.name, row.description, row.certificate_text])));
      paint();
    },
  });
})();
