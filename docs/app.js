const ICON = { yes: "✅", partial: "🟡", experimental: "🧪", unknown: "❔", no: "❌" };

const data = await fetch("./matrix.json").then((r) => {
  if (!r.ok) throw new Error(`Failed to load matrix: ${r.status}`);
  return r.json();
});

const table = document.querySelector("#matrix");
const search = document.querySelector("#search");
const category = document.querySelector("#category");
const dialog = document.querySelector("#detail");
const detail = document.querySelector("#detail-content");

document.querySelector("#updated").textContent = `Data checked ${data.updatedAt}`;

const categories = [...new Set(data.features.map((f) => f.category))].sort();
for (const item of categories) {
  const option = document.createElement("option");
  option.value = item;
  option.textContent = item;
  category.append(option);
}

table.querySelector("thead").innerHTML = `<tr><th>Feature</th>${data.agents.map((a) => `<th>${a.name}</th>`).join("")}</tr>`;

function render() {
  const q = search.value.trim().toLowerCase();
  const cat = category.value;
  const rows = data.features.filter((f) =>
    (!cat || f.category === cat) &&
    (!q || [f.id, f.name, f.category, f.description].some((v) => String(v).toLowerCase().includes(q)))
  );

  table.querySelector("tbody").innerHTML = rows.map((feature) => `
    <tr>
      <td><div>${feature.name}</div><small>${feature.category}</small></td>
      ${data.agents.map((agent) => {
        const cell = feature.support[agent.id] ?? { status: "unknown", note: "No data" };
        return `<td><button class="status" data-feature="${feature.id}" data-agent="${agent.id}" title="${escapeHtml(cell.note)}"><span>${ICON[cell.status] ?? "·"}</span><small>${cell.status}</small></button></td>`;
      }).join("")}
    </tr>
  `).join("");

  for (const button of table.querySelectorAll(".status")) {
    button.addEventListener("click", () => openDetail(button.dataset.feature, button.dataset.agent));
  }
}

function openDetail(featureId, agentId) {
  const feature = data.features.find((f) => f.id === featureId);
  const agent = data.agents.find((a) => a.id === agentId);
  const cell = feature.support[agentId];
  const evidence = cell.evidence?.map((item) =>
    `<li><a class="detail-evidence" href="${item.url}" target="_blank" rel="noreferrer">${item.type}: ${escapeHtml(item.url)}</a><br><small>checked ${item.checked}</small></li>`
  ).join("") || "<li>No evidence attached yet.</li>";
  detail.innerHTML = `
    <p class="detail-status">${ICON[cell.status]} <strong>${agent.name}</strong> · ${cell.status}</p>
    <h2>${feature.name}</h2>
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

search.addEventListener("input", render);
category.addEventListener("change", render);
document.querySelector(".close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
document.querySelector("#copy-command").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText("node src/cli.js check . --agent codex");
  event.currentTarget.textContent = "Copied";
  setTimeout(() => event.currentTarget.textContent = "Copy CLI command", 1200);
});

render();
