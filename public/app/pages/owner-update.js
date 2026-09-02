/**
 * Owner → Application management.
 * Upload a new version as a ZIP, watch the upgrade run, review the database
 * migration state and update history, and restart the application.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const readBase64 = (file) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read that file"));
    fr.onload = () => resolve(String(fr.result).split(",").pop());
    fr.readAsDataURL(file);
  });

export async function renderOwnerUpdate(view, { api, esc, toast, fmtDate }) {
  const draw = async () => {
    const s = (await api("/api/update/status")) || {};
    const history = arr(await api("/api/update/history"));
    const last = s.last_update;
    let gh = null;
    try {
      gh = await api("/api/update/github");
    } catch {
      /* offline or GitHub unreachable — the panel shows the error */
    }

    const badge = (status) => {
      const tone = status === "Success" ? "var(--ok, #1a7f37)" : status === "Running" ? "var(--muted)" : "var(--danger)";
      return `<span style="color:${tone};font-weight:600">${esc(status || "—")}</span>`;
    };

    view.innerHTML = `
      <div class="panel">
        <h3 style="margin-top:0">Application version</h3>
        <div class="row">
          <div><label>Installed version</label><div style="font-size:1.3rem;font-weight:700">v${esc(s.version)}</div></div>
          <div><label>Node.js</label><div>${esc(s.node)}</div></div>
          <div><label>Running since</label><div>${esc(fmtDate(s.started_at))}</div></div>
          <div><label>Migrations applied</label><div>${esc(s.migration_counts?.applied ?? 0)}${
            s.migration_counts?.failed ? ` · <span style="color:var(--danger)">${esc(s.migration_counts.failed)} failed</span>` : ""
          }</div></div>
        </div>
        <p class="muted">Application folder: <code>${esc(s.app_root)}</code></p>
        <div class="row" style="align-items:flex-end">
          <div>
            <label>Set version manually</label>
            <input id="verInput" placeholder="e.g. 3.10.0" value="${esc(s.version === "unknown" ? "" : s.version)}" />
          </div>
          <button class="ghost" id="verSave">Save version</button>
          <button class="ghost" id="verSync">Sync from GitHub release</button>
        </div>
        <p class="muted" id="verInfo">The installed version updates automatically after every upgrade. Use these
          only if you replaced the files by hand.</p>
      </div>


      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Automatic update from GitHub</h3>
        <p class="muted">The application checks the official release page once a day. Repository:
          <code>${esc(gh?.repo || "—")}</code></p>
        <div class="row">
          <div><label>Current version</label><div style="font-size:1.2rem;font-weight:700">v${esc((gh?.installed_version) || s.version)}</div></div>
          <div><label>Latest version</label><div style="font-size:1.2rem;font-weight:700">${esc(gh?.latest_version || "—")}</div></div>
          <div><label>Status</label><div id="ghStatus" style="font-weight:700;color:${
            gh?.update_available ? "var(--danger)" : "var(--ok, #1a7f37)"
          }">${esc(gh?.status || "Unknown")}</div></div>
          <div><label>Last checked</label><div class="muted">${esc(fmtDate(gh?.last_checked) || "never")}</div></div>
        </div>
        ${gh?.error ? `<p style="color:var(--danger)">Last check failed: ${esc(gh.error)}</p>` : ""}
        ${
          gh?.update_available
            ? `<p style="font-weight:600">Update Available — Version ${esc(gh.latest_version)}${
                gh.release?.html_url ? ` · <a href="${esc(gh.release.html_url)}" target="_blank" rel="noopener">release notes</a>` : ""
              }</p>`
            : ""
        }
        <div class="row" style="align-items:center">
          <button class="ghost" id="ghCheck">Check for updates</button>
          <button id="ghInstall" ${gh?.update_available ? "" : "disabled"}>Update now</button>
        </div>
        <p class="muted" id="ghInfo"></p>
        <div id="ghLog" class="muted" style="margin-top:.6rem"></div>
      </div>


      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Node modules (security &amp; versions)</h3>
        <p class="muted">Check the installed Node.js packages for newer versions and known security advisories,
          then update them from here — no command line needed. Restart the application after an update.</p>
        <div class="row" style="align-items:center">
          <button class="ghost" id="nmScan">Check node modules</button>
          <button class="ghost" id="nmAuditFix" disabled>Fix security issues (safe)</button>
          <button class="ghost" id="nmAuditForce" disabled>Force fix (may break)</button>
          <button class="ghost" id="nmUpdateAll" disabled>Update all (within safe range)</button>
          <button id="nmInstallSel" disabled>Update selected to latest</button>
        </div>
        <p class="muted" id="nmInfo">Not checked yet.</p>
        <div id="nmResult"></div>
        <div id="nmLog" class="muted" style="margin-top:.6rem"></div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Update application</h3>
        <p class="muted">Upload the new version as a ZIP file. It must contain <code>package.json</code> and
          <code>src/server.js</code>, and may contain a <code>db</code> folder with <code>.sql</code> upgrade scripts.
          Your <code>.env</code>, member photos, uploads and backups are never overwritten.</p>
        <div class="row" style="align-items:center">
          <input type="file" id="upFile" accept=".zip,application/zip" />
          <button class="ghost" id="upCheck">Validate package</button>
          <button id="upInstall">Upload &amp; upgrade</button>
        </div>
        <p class="muted" id="upInfo"></p>
        <div id="upLog" class="muted" style="margin-top:.6rem"></div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Database upgrade status</h3>
        ${
          last
            ? `<p>Last package <strong>${esc(last.filename)}</strong> — ${badge(last.status)} ·
                ${esc(last.migrations_applied || 0)} migration(s) applied ${last.error ? `<br><span style="color:var(--danger)">${esc(last.error)}</span>` : ""}</p>`
            : `<p class="muted">No upgrade has been run from this console yet.</p>`
        }
        ${
          arr(s.migrations).length
            ? `<div style="overflow:auto"><table><thead><tr><th>Script</th><th>Status</th><th>Applied</th></tr></thead>
               <tbody>${s.migrations
                 .map(
                   (m) => `<tr><td>${esc(m.filename)}</td><td>${badge(m.status)}</td>
                     <td class="muted">${esc(fmtDate(m.applied_at))}</td></tr>`,
                 )
                 .join("")}</tbody></table></div>`
            : `<p class="muted">No migration scripts have run yet.</p>`
        }
      </div>

      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Restart application</h3>
        <p class="muted">Stops the current process and starts the updated version. Use this right after an upgrade.
          Keep the app started with <code>start.bat</code> (Windows) or <code>start-loop.sh</code> so it comes back automatically.</p>
        <button id="restartBtn">Restart application</button>
        <p class="muted" id="restartStatus"></p>
      </div>

      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Recovery — application backups</h3>
        ${
          arr(s.backups).length
            ? `<div class="row" style="align-items:center">
                 <select id="bkSel">${s.backups.map((b) => `<option value="${esc(b.path)}">${esc(b.name)}</option>`).join("")}</select>
                 <button class="ghost" id="bkRestore">Restore selected backup</button>
               </div>
               <p class="muted">Every upgrade copies the current application here first, so a bad package can always be undone.</p>`
            : `<p class="muted">No application backups yet — one is created automatically before each upgrade.</p>`
        }
      </div>

      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Update history</h3>
        ${
          history.length
            ? `<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Package</th><th>From</th><th>To</th>
                 <th>Migrations</th><th>Status</th><th>By</th></tr></thead>
               <tbody>${history
                 .map(
                   (h) => `<tr><td class="muted">${esc(fmtDate(h.started_at))}</td><td>${esc(h.filename)}</td>
                     <td>${esc(h.from_version || "—")}</td><td>${esc(h.to_version || "—")}</td>
                     <td>${esc(h.migrations_applied || 0)}</td><td>${badge(h.status)}</td>
                     <td class="muted">${esc(h.started_by || "—")}</td></tr>`,
                 )
                 .join("")}</tbody></table></div>`
            : `<p class="muted">No updates recorded yet.</p>`
        }
      </div>`;

    const info = view.querySelector("#upInfo");
    const logBox = view.querySelector("#upLog");
    const fileInput = view.querySelector("#upFile");

    const showSteps = (steps) => {
      logBox.innerHTML = arr(steps)
        .map((st) => {
          const colour =
            st.level === "error" ? "var(--danger)" : st.level === "success" ? "var(--ok, #1a7f37)" : "inherit";
          return `<div style="color:${colour}">${esc(fmtDate(st.at))} — ${esc(st.message)}</div>`;
        })
        .join("");
    };

    /* ---- Installed version (manual correction / GitHub sync) ---- */
    const verInfo = view.querySelector("#verInfo");
    const saveVersion = async (btn, body, busy) => {
      btn.disabled = true;
      verInfo.textContent = busy;
      try {
        const r = await api("/api/update/version", { method: "POST", body });
        toast(`Installed version is now v${r.version}`);
        await draw();
      } catch (e) {
        verInfo.textContent = e.message;
        toast(e.message, true);
        btn.disabled = false;
      }
    };
    view.querySelector("#verSave").onclick = (ev) =>
      saveVersion(ev.target, { version: view.querySelector("#verInput").value.trim() }, "Saving…");
    view.querySelector("#verSync").onclick = (ev) =>
      saveVersion(ev.target, {}, "Reading the latest release tag from GitHub…");


    /* ---- GitHub automatic update ---- */
    const ghInfo = view.querySelector("#ghInfo");
    const ghLog = view.querySelector("#ghLog");
    const ghLine = (message, level = "info") => {
      const colour = level === "error" ? "var(--danger)" : level === "success" ? "var(--ok, #1a7f37)" : "inherit";
      ghLog.insertAdjacentHTML("beforeend", `<div style="color:${colour}">${esc(message)}</div>`);
    };

    view.querySelector("#ghCheck").onclick = async (ev) => {
      ev.target.disabled = true;
      ghInfo.textContent = "Checking the latest release on GitHub…";
      try {
        const r = await api("/api/update/github/check", { method: "POST" });
        ghInfo.textContent = r.update_available
          ? `Update Available — Version ${r.latest_version}`
          : r.error
            ? `Check failed: ${r.error}`
            : "Application is up to date.";
        toast(ghInfo.textContent);
        await draw();
      } catch (e) {
        ghInfo.textContent = `Check failed: ${e.message}`;
        toast(e.message, true);
        ev.target.disabled = false;
      }
    };

    view.querySelector("#ghInstall").onclick = async (ev) => {
      if (!confirm(`Download and install ${gh?.latest_version} from GitHub? A backup of the files and database is taken first.`)) return;
      ev.target.disabled = true;
      ghLog.innerHTML = "";
      view.querySelector("#ghStatus").textContent = "Updating";
      ghInfo.textContent = "Updating — do not close this window…";
      ["Checking latest release…", "Downloading update…", "Creating backup…", "Extracting files…", "Updating database…"].forEach((m) =>
        ghLine(m),
      );
      try {
        const r = await api("/api/update/github/install", { method: "POST" });
        ghLog.innerHTML = "";
        arr(r.steps).forEach((st) => ghLine(`${fmtDate(st.at)} — ${st.message}`, st.level));
        if (r.upToDate) {
          ghInfo.textContent = "Application is already up to date.";
        } else {
          ghLine("Update completed successfully. Restart the application to run the new version.", "success");
          ghInfo.textContent = `Updated to ${r.tag || `v${r.version}`}. Restart the application below.`;
        }
        view.querySelector("#ghStatus").textContent = "Update Completed";
        toast("Update completed");
      } catch (e) {
        ghLine(`Update failed: ${e.message}`, "error");
        view.querySelector("#ghStatus").textContent = "Update Failed";
        ghInfo.textContent = `Update failed: ${e.message}`;
        toast(e.message, true);
        ev.target.disabled = false;
      }
    };

    const pick = async () => {
      const file = fileInput.files?.[0];
      if (!file) throw new Error("Choose a ZIP package first");
      return { filename: file.name, data: await readBase64(file) };
    };

    view.querySelector("#upCheck").onclick = async () => {
      try {
        info.textContent = "Validating…";
        const r = await api("/api/update/validate", { method: "POST", body: await pick() });
        info.textContent = `${r.name} v${r.version} · ${r.files} files · ${r.size_mb} MB · ${r.migrations.length} migration script(s)` +
          (r.migrations.length ? `: ${r.migrations.join(", ")}` : "");
        toast("Package looks valid");
      } catch (e) {
        info.textContent = `Rejected: ${e.message}`;
        toast(e.message, true);
      }
    };

    view.querySelector("#upInstall").onclick = async (ev) => {
      let body;
      try {
        body = await pick();
      } catch (e) {
        return toast(e.message, true);
      }
      if (!confirm(`Upgrade the application with ${body.filename}? A backup of the current files and database is taken first.`)) return;
      ev.target.disabled = true;
      info.textContent = "Uploading and upgrading — do not close this window…";
      try {
        const r = await api("/api/update/install", { method: "POST", body });
        showSteps(r.steps);
        info.textContent = `Upgraded to v${r.version}. Restart the application to run the new version.`;
        toast("Upgrade completed");
      } catch (e) {
        info.textContent = `Upgrade failed: ${e.message}`;
        toast(e.message, true);
      } finally {
        ev.target.disabled = false;
        try {
          const s2 = await api("/api/update/status");
          if (s2) await draw();
        } catch {
          /* ignore */
        }
      }
    };

    /* ---- Node modules (npm) ---- */
    const nmInfo = view.querySelector("#nmInfo");
    const nmResult = view.querySelector("#nmResult");
    const nmLog = view.querySelector("#nmLog");
    const nmButtons = ["#nmAuditFix", "#nmAuditForce", "#nmUpdateAll", "#nmInstallSel"].map((s) => view.querySelector(s));
    const sevColour = (s) =>
      s === "critical" || s === "high" ? "var(--danger)" : s === "moderate" ? "#b26a00" : "var(--muted)";

    const renderModules = (d) => {
      const sc = d.severity_counts || {};
      const chips = ["critical", "high", "moderate", "low"]
        .map((k) => `<span style="color:${sevColour(k)};font-weight:600">${esc(sc[k] || 0)} ${k}</span>`)
        .join(" · ");
      nmInfo.innerHTML = `Checked ${esc(fmtDate(d.checked_at))} · ${esc(d.outdated_count)} outdated of
        ${esc(d.total_dependencies)} packages · vulnerabilities: ${chips}
        ${arr(d.errors).length ? `<br><span style="color:var(--danger)">${esc(d.errors.join(" "))}</span>` : ""}`;

      nmResult.innerHTML = `
        ${
          arr(d.vulnerabilities).length
            ? `<h4>Security advisories</h4><div style="overflow:auto"><table><thead><tr><th>Package</th><th>Severity</th>
                 <th>Issue</th><th>Fix</th></tr></thead><tbody>${d.vulnerabilities
                   .map(
                     (v) => `<tr><td>${esc(v.name)}${v.direct ? "" : ' <span class="muted">(indirect)</span>'}</td>
                       <td style="color:${sevColour(v.severity)};font-weight:600">${esc(v.severity)}</td>
                       <td>${esc(v.via.join("; ") || "—")}${
                         v.url ? ` · <a href="${esc(v.url)}" target="_blank" rel="noopener">details</a>` : ""
                       }</td>
                       <td>${v.fix_available ? (v.fix_is_major ? "Fix needs force" : "Fix available") : "No fix yet"}</td></tr>`,
                   )
                   .join("")}</tbody></table></div>`
            : `<p class="muted">No known security advisories in the installed packages.</p>`
        }
        ${
          arr(d.outdated).length
            ? `<h4>Outdated packages</h4><div style="overflow:auto"><table><thead><tr><th></th><th>Package</th>
                 <th>Installed</th><th>Safe update</th><th>Latest</th></tr></thead><tbody>${d.outdated
                   .map(
                     (p) => `<tr><td><input type="checkbox" class="nmPick" value="${esc(p.name)}" /></td>
                       <td>${esc(p.name)}</td><td>${esc(p.current || "—")}</td><td>${esc(p.wanted || "—")}</td>
                       <td${p.major ? ' style="color:#b26a00;font-weight:600"' : ""}>${esc(p.latest || "—")}</td></tr>`,
                   )
                   .join("")}</tbody></table></div>
               <p class="muted">A latest version shown in orange is a major upgrade — test it before using it in production.</p>`
            : `<p class="muted">Every package is up to date.</p>`
        }`;
      nmButtons.forEach((b) => (b.disabled = false));
    };

    const nmLine = (steps) => {
      nmLog.innerHTML = arr(steps)
        .map((st) => {
          const colour =
            st.level === "error" ? "var(--danger)" : st.level === "success" ? "var(--ok, #1a7f37)" : "inherit";
          return `<div style="color:${colour}">${esc(st.message)}</div>`;
        })
        .join("");
    };

    const nmScan = view.querySelector("#nmScan");
    const runScan = async () => {
      nmScan.disabled = true;
      nmButtons.forEach((b) => (b.disabled = true));
      nmInfo.textContent = "Checking npm for newer versions and security advisories… this can take a minute.";
      try {
        renderModules((await api("/api/update/modules")) || {});
      } catch (e) {
        nmInfo.textContent = e.message;
        toast(e.message, true);
      } finally {
        nmScan.disabled = false;
      }
    };
    nmScan.onclick = runScan;

    const runModuleUpdate = async (mode, packages, question) => {
      if (!confirm(question)) return;
      nmScan.disabled = true;
      nmButtons.forEach((b) => (b.disabled = true));
      nmLog.textContent = "Running npm… please wait, do not close this page.";
      try {
        const r = await api("/api/update/modules/update", { method: "POST", body: { mode, packages } });
        nmLine(r.steps);
        toast(r.ok ? "Node modules updated. Restart the application." : "npm reported a problem — see the log.", !r.ok);
      } catch (e) {
        nmLog.innerHTML = `<div style="color:var(--danger)">${esc(e.message)}</div>`;
        toast(e.message, true);
      } finally {
        nmScan.disabled = false;
        await runScan();
      }
    };

    view.querySelector("#nmAuditFix").onclick = () =>
      runModuleUpdate("audit-fix", [], "Apply the safe security fixes (npm audit fix)?");
    view.querySelector("#nmAuditForce").onclick = () =>
      runModuleUpdate("audit-fix-force", [], "Force the security fixes? This can install major versions that change behaviour.");
    view.querySelector("#nmUpdateAll").onclick = () =>
      runModuleUpdate("update", [], "Update all packages within their safe version range?");
    view.querySelector("#nmInstallSel").onclick = () => {
      const picked = [...view.querySelectorAll(".nmPick:checked")].map((c) => c.value);
      if (!picked.length) return toast("Tick the packages you want to update first.", true);
      runModuleUpdate("install", picked, `Update ${picked.length} package(s) to the latest version?`);
    };

    const restartStatus = view.querySelector("#restartStatus");
    view.querySelector("#restartBtn").onclick = async (ev) => {
      if (!confirm("Restart the application now? Kiosks will be offline for a few seconds.")) return;
      ev.target.disabled = true;
      restartStatus.textContent = "Stopping the application…";
      try {
        await api("/api/update/restart", { method: "POST" });
      } catch {
        /* the connection drops as the process exits — expected */
      }
      restartStatus.textContent = "Waiting for the application to come back…";
      const deadline = Date.now() + 90000;
      const poll = async () => {
        try {
          const res = await fetch("/api/health", { cache: "no-store" });
          if (res.ok) {
            restartStatus.textContent = "Application is back. Reloading…";
            setTimeout(() => location.reload(), 800);
            return;
          }
        } catch {
          /* still down */
        }
        if (Date.now() > deadline) {
          restartStatus.textContent = "The application did not come back automatically. Start it again on the server (start.bat).";
          ev.target.disabled = false;
          return;
        }
        setTimeout(poll, 1500);
      };
      setTimeout(poll, 2500);
    };

    const bkRestore = view.querySelector("#bkRestore");
    if (bkRestore) {
      bkRestore.onclick = async () => {
        const target = view.querySelector("#bkSel").value;
        if (!confirm("Restore these application files? The current files will be replaced.")) return;
        try {
          const r = await api("/api/update/rollback", { method: "POST", body: { path: target } });
          toast(r.message);
        } catch (e) {
          toast(e.message, true);
        }
      };
    }
  };

  await draw();
}
