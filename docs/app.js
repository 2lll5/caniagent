const ICON = { yes: "✅", partial: "🟡", experimental: "🧪", unknown: "❔", no: "❌" };

let data;
const table = document.querySelector("#matrix");
const search = document.querySelector("#search");
const category = document.querySelector("#category");
const dialog = document.querySelector("#detail");
const detail = document.querySelector("#detail-content");
const updated = document.querySelector("#updated");
const retry = document.querySelector("#retry-matrix");

async function loadData() {
  search.disabled = true;
  category.disabled = true;
  retry.hidden = true;
  updated.textContent = "Loading compatibility data…";
  try {
    const response = await fetch("./matrix.json");
    if (!response.ok) throw new Error(`Failed to load matrix: ${response.status}`);
    data = await response.json();
    const categories = [...new Set(data.features.map((f) => f.category))].sort();
    category.replaceChildren(new Option("All categories", ""));
    for (const item of categories) category.append(new Option(item, item));
    table.querySelector("thead").innerHTML = `<tr><th scope="col">Feature</th>${data.agents.map((a) => `<th scope="col">${escapeHtml(a.name)}</th>`).join("")}</tr>`;
    render();
    updated.textContent = `Data checked ${data.updatedAt}`;
    search.disabled = false;
    category.disabled = false;
  } catch {
    table.querySelector("thead").replaceChildren();
    table.querySelector("tbody").replaceChildren();
    updated.textContent = "Compatibility data could not be loaded. Please try again.";
    retry.hidden = false;
  }
}

function render() {
  const q = search.value.trim().toLowerCase();
  const cat = category.value;
  const rows = data.features.filter((f) =>
    (!cat || f.category === cat) &&
    (!q || [f.id, f.name, f.category, f.description].some((v) => String(v).toLowerCase().includes(q)))
  );

  table.querySelector("tbody").innerHTML = rows.map((feature) => `
    <tr>
      <td><div>${escapeHtml(feature.name)}</div><small>${escapeHtml(feature.category)}</small></td>
      ${data.agents.map((agent) => {
        const cell = feature.support[agent.id] ?? { status: "unknown", note: "No data" };
        return `<td><button class="status" data-feature="${escapeHtml(feature.id)}" data-agent="${escapeHtml(agent.id)}" aria-label="${escapeHtml(`${feature.name}, ${agent.name}: ${cell.status}`)}" title="${escapeHtml(cell.note)}"><span>${ICON[cell.status] ?? "·"}</span><small>${escapeHtml(cell.status)}</small></button></td>`;
      }).join("")}
    </tr>
  `).join("") || `<tr><td colspan="${data.agents.length + 1}">No features match these filters.</td></tr>`;

  for (const button of table.querySelectorAll(".status")) {
    button.addEventListener("click", () => openDetail(button.dataset.feature, button.dataset.agent));
  }
}

function openDetail(featureId, agentId) {
  const feature = data.features.find((f) => f.id === featureId);
  const agent = data.agents.find((a) => a.id === agentId);
  const cell = feature.support[agentId] ?? { status: "unknown", note: "No data" };
  const evidence = cell.evidence?.map((item) =>
    `<li>${evidenceLink(item)}<br><small>checked ${escapeHtml(item.checked)}</small></li>`
  ).join("") || "<li>No evidence attached yet.</li>";
  detail.innerHTML = `
    <p class="detail-status">${ICON[cell.status] ?? "❔"} <strong>${escapeHtml(agent.name)}</strong> · ${escapeHtml(cell.status)}</p>
    <h2 id="detail-title">${escapeHtml(feature.name)}</h2>
    <p>${escapeHtml(feature.description)}</p>
    <p>${escapeHtml(cell.note)}</p>
    <h3>Evidence</h3>
    <ul>${evidence}</ul>
  `;
  dialog.showModal();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
}

function evidenceLink(item) {
  const label = `${escapeHtml(item.type)}: ${escapeHtml(item.url)}`;
  try {
    const url = new URL(item.url);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return `<a class="detail-evidence" href="${escapeHtml(url.href)}" target="_blank" rel="noreferrer">${label}</a>`;
    }
  } catch { /* Invalid evidence remains visible as text. */ }
  return label;
}

search.addEventListener("input", render);
category.addEventListener("change", render);
retry.addEventListener("click", loadData);
document.querySelector(".close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
document.querySelector("#copy-command").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const message = document.querySelector("#copy-status");
  button.disabled = true;
  message.textContent = "";
  try {
    await navigator.clipboard.writeText(document.querySelector("#cli-command").textContent);
    button.textContent = "Copied";
    message.textContent = "CLI command copied.";
  } catch {
    message.textContent = "Could not copy automatically. Select and copy the command shown below.";
  } finally {
    setTimeout(() => {
      button.textContent = "Copy CLI command";
      button.disabled = false;
    }, 1200);
  }
});

await loadData();
