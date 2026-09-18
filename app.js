(() => {
  "use strict";

  const candidateOrder = [
    { id: "gladunov", name: "Гладунов Юрий Николаевич", short: "Юрий Гладунов" },
    { id: "dudoladov", name: "Дудоладов Глеб Борисович", short: "Глеб Дудоладов" },
    { id: "zverev", name: "Зверев Артём Александрович", short: "Артём Зверев" },
    { id: "lugovskoy", name: "Луговской Роман Андреевич", short: "Роман Луговской" }
  ];

  // Only claims explicitly assigned here enter the public comparison table.
  // Unassigned rows remain available in the source ledger and are not silently
  // treated as an answer to an issue question.
  const issueClaimIds = {
    ISS01: [],
    ISS02: ["73"],
    ISS03: ["22", "83", "85"],
    ISS04: ["78", "79"],
    ISS05: ["70", "74", "75"],
    ISS06: ["79"],
    ISS07: ["70", "72", "94"],
    ISS08: ["23", "24", "84", "95"]
  };

  const state = {
    candidates: [],
    candidateById: new Map(),
    claims: [],
    claimsById: new Map(),
    issues: [],
    selectedCandidates: new Set(candidateOrder.map((candidate) => candidate.id)),
    topic: "all",
    evidence: "all",
    search: "",
    allIssuesOpen: false
  };

  const $ = (selector) => document.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, document.baseURI);
      if (!["http:", "https:"].includes(url.protocol)) return "#";
      return escapeHtml(url.href);
    } catch (_error) {
      return "#";
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }

    const headers = rows.shift() || [];
    return rows.map((values) => headers.reduce((object, header, index) => {
      object[header] = values[index] ?? "";
      return object;
    }, {}));
  }

  function classifyAttribution(row) {
    const text = `${row.uroven_atributsii} ${row.tip_istochnika} ${row.zametka}`.toLowerCase();
    if (text.includes("партийн") || text.includes("партийный")) return "party";
    if (text.includes("соавтор") || text.includes("коллектив") || text.includes("совмест")) return "collective";
    if (text.includes("сми") || text.includes("журналист") || text.includes("переданное СМИ".toLowerCase())) return "media";
    if (text.includes("личн") || text.includes("официальн") || text.includes("реестр")) return "personal";
    return "registry";
  }

  function attributionLabel(type) {
    return {
      personal: "Личное",
      collective: "Коллективное",
      party: "Партия",
      media: "СМИ",
      registry: "Реестр"
    }[type] || "Источник";
  }

  function candidateIdFromName(name) {
    const candidate = candidateOrder.find((item) => item.name === name);
    return candidate ? candidate.id : null;
  }

  function parseCandidates(raw) {
    const sourceCandidates = raw?.candidates || [];
    return candidateOrder.map((orderItem) => {
      const source = sourceCandidates.find((candidate) => candidate.full_name === orderItem.name) || {};
      return { ...orderItem, ...source };
    });
  }

  function issueClaims(issueId) {
    const ids = issueClaimIds[issueId] || [];
    return ids.map((id) => state.claimsById.get(id)).filter(Boolean);
  }

  function rowMatchesFilters(row) {
    const candidateId = candidateIdFromName(row.kandidat);
    if (candidateId && !state.selectedCandidates.has(candidateId)) return false;

    const attribution = classifyAttribution(row);
    if (state.evidence === "personal" && !["personal", "collective"].includes(attribution)) return false;
    if (state.evidence === "party" && attribution !== "party") return false;
    if (state.evidence === "needs-review" && !row.status.toLowerCase().includes("уточнить") && !row.status.toLowerCase().includes("не найден")) return false;

    const search = state.search.trim().toLowerCase();
    if (search) {
      const haystack = [row.tema, row.utverzhdenie, row.citata, row.kandidat, row.istochnik].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }

  function renderSource(row) {
    return `<a class="source-link" href="${safeUrl(row.source_url)}" target="_blank" rel="noopener" aria-label="Открыть источник: ${escapeHtml(row.istochnik)}">Источник</a>`;
  }

  function renderExternalSource(url, label, ariaLabel = label) {
    return `<a class="external-source" href="${safeUrl(url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(label)}</a>`;
  }

  function renderClaim(row) {
    const attribution = classifyAttribution(row);
    const status = row.status.toLowerCase().includes("уточнить") || row.status.toLowerCase().includes("не найден") ? "needs-review" : "";
    return `<div class="evidence-cell ${attribution === "party" ? "is-party" : ""}">
      <div class="evidence-name">
        <strong>${escapeHtml(candidateOrder.find((item) => item.name === row.kandidat)?.short || row.kandidat)}</strong>
        <span class="party-name">${escapeHtml(row.data)}</span>
      </div>
      <span class="badge badge-${escapeHtml(attribution)}">${escapeHtml(attributionLabel(attribution))}</span>
      <p>${escapeHtml(row.utverzhdenie)}</p>
      ${row.citata ? `<p class="quote">${escapeHtml(row.citata)}</p>` : ""}
      <div class="evidence-meta">
        ${status ? `<span class="badge badge-muted">Нужно уточнить</span>` : ""}
        ${row.scope ? `<span class="badge badge-muted">${escapeHtml(row.scope)}</span>` : ""}
      </div>
      ${renderSource(row)}
    </div>`;
  }

  function renderEmpty(candidate, message) {
    return `<div class="evidence-cell is-empty">
      <div class="evidence-name">
        <strong>${escapeHtml(candidate.short)}</strong>
        <span class="party-name">${escapeHtml(candidate.party || "")}</span>
      </div>
      <span class="badge badge-muted">Персональное подтверждение</span>
      <p class="empty-note">${escapeHtml(message)}</p>
    </div>`;
  }

  function renderLedger() {
    const ledger = $("#ledger-list");
    if (!ledger) return;
    $("#ledger-count").textContent = `(${state.claims.length} записей)`;
    ledger.innerHTML = state.claims.map((row) => {
      const attribution = classifyAttribution(row);
      const subject = row.kandidat === "все" ? "Общий контекст" : row.kandidat;
      return `<article class="ledger-entry">
        <div class="ledger-entry-head">
          <strong>${escapeHtml(subject)}</strong>
          <span class="badge badge-${escapeHtml(attribution)}">${escapeHtml(attributionLabel(attribution))}</span>
        </div>
        <p class="ledger-topic">${escapeHtml(row.tema)} · ${escapeHtml(row.data)}</p>
        <p>${escapeHtml(row.utverzhdenie)}</p>
        ${row.citata ? `<p class="quote">${escapeHtml(row.citata)}</p>` : ""}
        <div class="ledger-entry-foot">
          <span class="badge badge-muted">${escapeHtml(row.status || "статус не указан")}</span>
          ${renderSource(row)}
        </div>
      </article>`;
    }).join("");
  }

  function setAllIssuesOpen(open) {
    state.allIssuesOpen = open;
    document.querySelectorAll("#comparison-list details.issue-card").forEach((issue) => {
      issue.open = open;
    });
    const toggle = $("#disclosure-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Свернуть все вопросы" : "Раскрыть все вопросы";
    }
  }

  function renderComparison() {
    const list = $("#comparison-list");
    const selectedIssues = state.topic === "all" ? state.issues : state.issues.filter((issue) => issue.issue_id === state.topic);
    const cards = [];
    let visibleClaims = 0;

    selectedIssues.forEach((issue) => {
      const claims = issueClaims(issue.issue_id).filter(rowMatchesFilters);
      const issueText = `${issue.category} ${issue.question_text}`.toLowerCase();
      if (state.search && !issueText.includes(state.search.trim().toLowerCase()) && claims.length === 0) return;
      visibleClaims += claims.length;

      const byCandidate = new Map();
      claims.forEach((claim) => {
        const id = candidateIdFromName(claim.kandidat);
        if (!id) return;
        if (!byCandidate.has(id)) byCandidate.set(id, []);
        byCandidate.get(id).push(claim);
      });

      const cells = candidateOrder
        .filter((candidate) => state.selectedCandidates.has(candidate.id))
        .map((candidate) => {
          const candidateClaims = byCandidate.get(candidate.id) || [];
          if (!candidateClaims.length) {
            const allCandidateClaims = issueClaims(issue.issue_id).filter((row) => candidateIdFromName(row.kandidat) === candidate.id);
            const hasActiveFilter = state.evidence !== "all" || state.search.trim() !== "";
            let message = "В проверенных источниках персональное подтверждение не найдено для этой темы в текущей выборке. Это не означает позицию «против».";
            if (hasActiveFilter && allCandidateClaims.length) {
              message = "По текущему фильтру запись не показывается. Измените фильтр, чтобы увидеть доступный контекст; пустая ячейка не является позицией «против».";
            } else if (allCandidateClaims.length && allCandidateClaims.every((row) => classifyAttribution(row) === "party")) {
              message = "В проверенных источниках персональное подтверждение не найдено; есть только партийный контекст.";
            }
            return renderEmpty({ ...candidate, party: state.candidateById.get(candidate.id)?.party }, message);
          }
          return candidateClaims.map(renderClaim).join("");
        }).join("");

      cards.push(`<details class="issue-card" data-issue-id="${escapeHtml(issue.issue_id)}"${state.allIssuesOpen ? " open" : ""}>
        <summary class="issue-summary">
          <span class="issue-summary-copy">
            <span class="issue-code">${escapeHtml(issue.issue_id)}</span>
            <span>
              <span class="issue-title" role="heading" aria-level="3">${escapeHtml(issue.question_text)}</span>
              <span class="issue-competence">${escapeHtml(issue.assembly_competence_note)}</span>
            </span>
          </span>
        </summary>
        <p class="issue-source">${renderExternalSource(issue.competence_source_url, "Источник полномочия", `Источник полномочия для ${issue.category}`)}</p>
        <div class="evidence-grid">${cells}</div>
      </details>`);
    });

    list.innerHTML = cards.length ? cards.join("") : `<div class="error-card">По текущим фильтрам ничего не найдено. Попробуйте показать все уровни атрибуции или очистить поиск.</div>`;
    $("#compare-status").textContent = `Показано тем: ${cards.length} · доказательств в них: ${visibleClaims}. Пустая ячейка не является оценкой кандидата.`;
  }

  function shortRole(candidate) {
    const tracks = [];
    if (candidate.single_mandate_constituency) tracks.push(`одномандатник округа №${candidate.single_mandate_constituency}`);
    if (candidate.regional_group) tracks.push(`${candidate.regional_group}`);
    if (candidate.state_duma_constituency) tracks.push(`параллельный трек: Госдума №${candidate.state_duma_constituency}`);
    return tracks.join(" · ");
  }

  function isPartyContext(text) {
    const value = String(text || "").toLowerCase();
    return ["единая россия", "лдпр", "кпрф", "парт", "райком", "районного отделения", "секретарь политсовета", "координатор"].some((token) => value.includes(token));
  }

  function renderItems(items, emptyText = "Отдельной записи нет.") {
    const values = (items || []).filter(Boolean);
    return values.length ? `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="profile-empty">${escapeHtml(emptyText)}</p>`;
  }

  function renderProfileLinks(urls, candidate, limit = null) {
    const values = [...new Set((urls || []).filter((url) => typeof url === "string" && /^https?:\/\//.test(url)))];
    const visible = limit ? values.slice(0, limit) : values;
    return visible.length ? `<ul class="profile-links">${visible.map((url) => `<li>${renderExternalSource(url, url, `Открыть источник профиля ${candidate.short}`)}</li>`).join("")}</ul>` : `<p class="profile-empty">Источник не указан в профиле.</p>`;
  }

  function renderSocial(candidate) {
    const social = candidate.social || {};
    const personal = [];
    const party = [];
    const labels = { vk: "VK", max: "MAX", ok: "Одноклассники", telegram: "Telegram", facebook: "Facebook", x: "X" };
    Object.entries(social).forEach(([key, value]) => {
      if (typeof value === "string" && /^https?:\/\//.test(value)) {
        (key === "party_profile" || key === "party_channels" ? party : personal).push({ label: labels[key] || key, url: value });
      } else if (Array.isArray(value)) {
        value.filter((url) => typeof url === "string" && /^https?:\/\//.test(url)).forEach((url) => party.push({ label: key === "party_channels" ? "Партийный канал" : "Партийный профиль", url }));
      }
    });
    const personalHtml = personal.length ? `<ul class="profile-links">${personal.map((item) => `<li><span>${escapeHtml(item.label)}:</span> ${renderExternalSource(item.url, item.url, `Открыть публичный канал ${candidate.short}`)}</li>`).join("")}</ul>` : `<p class="profile-empty">В проверенных источниках персональный публичный канал не найден.</p>`;
    const partyHtml = party.length ? `<ul class="profile-links">${party.map((item) => `<li><span>${escapeHtml(item.label)}:</span> ${renderExternalSource(item.url, item.url, `Открыть партийный канал ${candidate.short}`)}</li>`).join("")}</ul>` : "";
    return `<div class="profile-subsection"><strong>Персональные публичные каналы</strong>${personalHtml}</div>${partyHtml ? `<div class="profile-subsection"><strong>Партийные каналы</strong>${partyHtml}</div>` : ""}`;
  }

  function renderSvoAudit(candidate) {
    const audit = candidate.svo_audit || {};
    const found = audit.personal_confirmation === "найдено";
    const auditSources = found ? audit.source_urls : audit.party_context_urls;
    const checked = audit.checked_search_urls || [];
    return `<div class="audit-note ${found ? "audit-found" : "audit-empty"}">
      <strong>Отдельная проверка материалов по СВО</strong>
      <p>${found ? "В проверенных источниках персональное подтверждение найдено." : "В проверенных источниках персональное подтверждение не найдено. Это не означает, что события не было."}</p>
      ${auditSources?.length ? `<span class="profile-label">Связанные источники</span>${renderProfileLinks(auditSources, candidate)}` : ""}
      ${!found && checked.length ? `<span class="profile-label">Проверенные поисковые страницы</span>${renderProfileLinks(checked, candidate)}` : ""}
    </div>`;
  }

  function renderCandidateRecords(rows) {
    return `<details class="profile-records">
      <summary>Все записи кандидата в матрице (${rows.length})</summary>
      <div class="profile-record-list">${rows.map((row) => `<article class="profile-record">
        <div class="ledger-entry-head"><strong>${escapeHtml(row.tema)}</strong><span class="badge badge-${escapeHtml(classifyAttribution(row))}">${escapeHtml(attributionLabel(classifyAttribution(row)))}</span></div>
        <p>${escapeHtml(row.utverzhdenie)}</p>
        ${row.citata ? `<p class="quote">${escapeHtml(row.citata)}</p>` : ""}
        <div class="ledger-entry-foot"><span class="badge badge-muted">${escapeHtml(row.status || "статус не указан")}</span>${renderSource(row)}</div>
      </article>`).join("")}</div>
    </details>`;
  }

  function renderCandidateCard(candidate) {
    const allRows = state.claims.filter((row) => candidateIdFromName(row.kandidat) === candidate.id);
    const mappedIssues = state.issues.filter((issue) => issueClaims(issue.issue_id).some((row) => candidateIdFromName(row.kandidat) === candidate.id)).length;
    const personalRows = allRows
      .filter((row) => ["personal", "collective"].includes(classifyAttribution(row)))
      .sort((a, b) => String(b.data).localeCompare(String(a.data)))
      .slice(0, 3);
    const positions = candidate.current_positions || [];
    const previousPositions = candidate.previous_positions || [];
    const roleItems = positions.filter((item) => !isPartyContext(item));
    const partyItems = positions.filter(isPartyContext);
    const previousRoleItems = previousPositions.filter((item) => !isPartyContext(item));
    const previousPartyItems = previousPositions.filter(isPartyContext);
    const gaps = candidate.matrix_gaps || [];

    return `<article class="candidate-card">
      <span class="eyebrow">${escapeHtml(candidate.party || "Кандидат")}</span>
      <h3>${escapeHtml(candidate.short)}</h3>
      <span class="party">${escapeHtml(candidate.party || "")}</span>
      <p class="candidate-role">${escapeHtml(shortRole(candidate) || "Участник выборов по округу №3")}</p>
      <p class="coverage-note"><strong>${mappedIssues}/${state.issues.length}</strong> тем имеют кодированную запись в текущем реестре. Это показатель покрытия данных, а не оценка кандидата.</p>
      <details>
        <summary>Показать индивидуальный контекст</summary>
        <div class="profile-sections">
          <section class="profile-subsection"><h4>Роли и занятия</h4>${renderItems(roleItems, "В профиле нет отдельной записи о текущей непартийной роли.")}</section>
          <section class="profile-subsection"><h4>Партийный контекст</h4>${renderItems(partyItems, "Отдельная партийная роль в профиле не указана.")}</section>
          <section class="profile-subsection"><h4>Предыдущий опыт</h4>${renderItems([...previousRoleItems, ...previousPartyItems], "Историческая запись в профиле не указана.")}</section>
          <section class="profile-subsection"><h4>Деловой контекст</h4>${renderItems(candidate.business, "В профиле отдельные бизнес-сведения не указаны.")}</section>
          <section class="profile-subsection"><h4>Публичные каналы</h4>${renderSocial(candidate)}</section>
          <section class="profile-subsection"><h4>Личные записи в матрице</h4>${personalRows.length ? personalRows.map((row) => `<p><strong>${escapeHtml(row.tema)}:</strong> ${escapeHtml(row.utverzhdenie)} ${renderSource(row)}</p>`).join("") : `<p class="profile-empty">В текущем реестре персональная запись по кандидату не выделена.</p>`}</section>
          ${renderCandidateRecords(allRows)}
          ${renderSvoAudit(candidate)}
          ${gaps.length ? `<section class="profile-subsection"><h4>Что ещё требует поиска</h4>${renderItems(gaps)}</section>` : ""}
          <section class="profile-subsection"><h4>Источники профиля</h4>${renderProfileLinks(candidate.key_sources, candidate)}</section>
          <section class="profile-subsection"><h4>Полный профиль данных</h4><p><a href="data/candidates.json" target="_blank" rel="noopener">Машиночитаемый JSON-профиль</a></p></section>
        </div>
      </details>
    </article>`;
  }

  function renderCandidates() {
    $("#candidate-grid").innerHTML = candidateOrder
      .map((orderItem) => state.candidateById.get(orderItem.id))
      .filter(Boolean)
      .map(renderCandidateCard)
      .join("");
  }

  function renderCandidateSwitcher() {
    $("#candidate-switcher").innerHTML = candidateOrder.map((orderItem) => {
      const candidate = state.candidateById.get(orderItem.id) || orderItem;
      const pressed = state.selectedCandidates.has(orderItem.id);
      return `<button type="button" data-candidate="${escapeHtml(orderItem.id)}" aria-pressed="${pressed}">${escapeHtml(candidate.short)}</button>`;
    }).join("");
  }

  function bindControls() {
    $("#topic-filter").addEventListener("change", (event) => {
      state.topic = event.target.value;
      renderComparison();
    });
    $("#evidence-filter").addEventListener("change", (event) => {
      state.evidence = event.target.value;
      renderComparison();
    });
    $("#search").addEventListener("input", (event) => {
      state.search = event.target.value;
      renderComparison();
    });
    $("#candidate-switcher").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-candidate]");
      if (!button) return;
      const id = button.dataset.candidate;
      if (state.selectedCandidates.has(id) && state.selectedCandidates.size === 1) return;
      if (state.selectedCandidates.has(id)) state.selectedCandidates.delete(id);
      else state.selectedCandidates.add(id);
      button.setAttribute("aria-pressed", String(state.selectedCandidates.has(id)));
      renderComparison();
    });
    $("#disclosure-toggle").addEventListener("click", () => {
      setAllIssuesOpen(!state.allIssuesOpen);
    });
  }

  async function loadData() {
    const base = document.baseURI;
    const [matrixResponse, candidatesResponse, issuesResponse] = await Promise.all([
      fetch(new URL("data/matriks.csv", base)),
      fetch(new URL("data/candidates.json", base)),
      fetch(new URL("data/issue_taxonomy.csv", base))
    ]);
    if (!matrixResponse.ok || !candidatesResponse.ok || !issuesResponse.ok) throw new Error("Не удалось загрузить один из файлов данных.");
    const [matrixText, candidateData, issueText] = await Promise.all([
      matrixResponse.text(),
      candidatesResponse.json(),
      issuesResponse.text()
    ]);
    return { claims: parseCsv(matrixText), candidates: parseCandidates(candidateData), issues: parseCsv(issueText) };
  }

  function showError(error) {
    $("#comparison-list").innerHTML = `<div class="error-card"><strong>Данные не загрузились.</strong><br>Для GitHub Pages сайт должен открываться по HTTP(S), а не через <code>file://</code>. Если ошибка сохраняется, проверьте доступ к папке <code>data/</code>.<br><small>${escapeHtml(error.message)}</small></div>`;
    $("#compare-status").textContent = "Ошибка загрузки данных";
  }

  async function init() {
    try {
      const data = await loadData();
      state.candidates = data.candidates;
      state.candidateById = new Map(data.candidates.map((candidate) => [candidate.id, candidate]));
      state.claims = data.claims;
      state.claimsById = new Map(data.claims.map((claim) => [claim.id, claim]));
      state.issues = data.issues;

      $("#stat-candidates").textContent = data.candidates.length;
      $("#stat-topics").textContent = data.issues.length;
      $("#stat-evidence").textContent = data.claims.length;
      $("#topic-filter").insertAdjacentHTML("beforeend", data.issues.map((issue) => `<option value="${escapeHtml(issue.issue_id)}">${escapeHtml(issue.category)}</option>`).join(""));
      renderCandidateSwitcher();
      renderComparison();
      renderCandidates();
      renderLedger();
      setAllIssuesOpen(state.allIssuesOpen);
      bindControls();
    } catch (error) {
      showError(error);
      console.error(error);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
