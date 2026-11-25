import { getPreference, setPreference, getPending, saveNote, exportPending, resolveNote } from "./outbox.js";
import { syncOne } from "./notes-sync.js";

const strings = {
  pl: {
    title:"Prywatne notatki", configuration:"Logowanie wymaga zarejestrowanej aplikacji GitHub z włączonym Device Flow.",
    signIn:"Zaloguj przez GitHub", cancel:"Anuluj", code:"Wpisz ten kod na github.com/login/device",
    connect:"Połącz prywatne repozytorium Notes", create:"Utwórz prywatne repozytorium Notes",
    newNote:"Nowa notatka", save:"Zapisz na urządzeniu", send:"Synchronizuj", edit:"Otwórz",
    export:"Eksportuj oczekujące zmiany", pending:"Oczekujące zmiany", clean:"Brak oczekujących zmian.",
    saved:"Zapisano na tym urządzeniu.", synced:"Zapisano i sprawdzono w GitHub.", editor:"Treść Markdown",
    offline:"Praca lokalna", connected:"Połączono z GitHub", logout:"Wyloguj", failed:"Nie udało się wykonać operacji.",
    retry:"Zmiany pozostają na urządzeniu.", conflict:"Konflikt wersji", resolve:"Zachowaj wybraną treść jako rozwiązanie",
    mine:"Zapis lokalny", remote:"Wersja z GitHub", alternative:"Inna zmiana lokalna", load:"Otwórz plik z repozytorium",
    active:"Notatkę można zapisać na tym urządzeniu także bez internetu.", exportText:"Pobierz tekst edytora", busy:"Synchronizacja trwa w innym oknie."
  },
  en: {
    title:"Private notes", configuration:"Sign-in requires a registered GitHub App with Device Flow enabled.",
    signIn:"Sign in with GitHub", cancel:"Cancel", code:"Enter this code at github.com/login/device",
    connect:"Connect private Notes repository", create:"Create private Notes repository",
    newNote:"New note", save:"Save on this device", send:"Synchronize", edit:"Open",
    export:"Export pending changes", pending:"Pending changes", clean:"No pending changes.",
    saved:"Saved on this device.", synced:"Saved and verified on GitHub.", editor:"Markdown text",
    offline:"Working locally", connected:"Connected to GitHub", logout:"Sign out", failed:"Could not complete the operation.",
    retry:"Pending edits remain on this device.", conflict:"Conflicting versions", resolve:"Save selected text as the resolution",
    mine:"Local text", remote:"GitHub version", alternative:"Other local edit", load:"Open a repository file",
    active:"You can save notes on this device while offline.", exportText:"Download editor text", busy:"Another window is synchronizing."
  }
};

function node(tag, text) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  return element;
}

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const anchor = node("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountNotes(parent, locale) {
  if (!parent || parent.querySelector(".private-notes")) return;
  const t = strings[locale];
  const panel = node("section");
  panel.className = "private-notes";
  const content = node("div"), status = node("p");
  status.setAttribute("role","status");
  panel.append(node("h2",t.title),content,status);
  (parent.querySelector(".page") ?? parent).append(panel);
  let session, binding, connected = false, pollGeneration = 0, editor;
  const invoke = (cmd,args) => window.__TAURI__.core.invoke(cmd,args);
  const get = args => invoke("github_get_note", args);
  const put = args => invoke("github_put_note", args);

  function button(label, action, container = content) {
    const b = node("button",label);
    b.type = "button";
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await action(); }
      catch (error) { status.textContent = t.failed + " " + String(error?.message ?? error) + " " + t.retry; }
      finally { b.disabled = false; }
    });
    container.append(b);
  }

  async function openEditor(row) {
    editor?.remove();
    editor = node("section");
    content.append(editor);
    editor.append(node("h3",row.path));
    const label = node("label",t.editor);
    const text = node("textarea");
    text.rows = 12;
    text.value = row.markdown;
    label.append(text);
    editor.append(label);
    if (row.state === "conflict") {
      const versions = [[t.mine,row.markdown],...(row.alternatives ?? []).map(a=>[t.alternative,a.markdown])];
      if (row.remote) versions.push([t.remote,row.remote.markdown]);
      for (const [name,body] of versions) {
        const details = node("details");
        details.append(node("summary",name),node("pre",body));
        editor.append(details);
      }
    }
    button(row.state === "conflict" ? t.resolve : t.save, async () => {
      if (row.state === "conflict") {
        const remote = Object.hasOwn(row,"remote") ? row.remote : {blobSha:row.baseSha,markdown:row.baseMarkdown};
        await resolveNote(row,text.value,remote);
      } else {
        await saveNote({...row,markdown:text.value},row.revision);
      }
      await show(); status.textContent = t.saved;
    },editor);
    button(t.exportText, () => download(text.value,row.path.split("/").pop(),"text/markdown;charset=utf-8"),editor);
    text.focus();
  }

  async function show() {
    const info = await invoke("github_status");
    if (!panel.isConnected) return;
    session = info.user;
    const selectedAccount = session ? Number(session.id) : await getPreference("notes","offlineAccount");
    binding = selectedAccount ? await getPreference("notes-account",String(selectedAccount)) : null;
    content.replaceChildren();
    if (!info.configured) { content.append(node("p",t.configuration)); return; }
    if (!session) button(t.signIn, login);
    else {
      content.append(node("p",t.connected + " · " + session.login));
      button(t.logout, async () => {
        await invoke("github_logout");
        await setPreference("notes","offlineAccount",null);
        connected=false; await show();
      });
    }
    if (session && !connected) {
      button(t.connect, () => connect(false));
      if (!binding) button(t.create, () => connect(true));
    }
    if (!binding) return;
    content.append(node("p",t.active));
    const target = { accountId:binding.accountId, repositoryId:binding.repositoryId, branch:binding.branch };
    button(t.newNote, () => openEditor({...target,path:"kdzj/notes/"+crypto.randomUUID()+".md",markdown:"",baseSha:null,revision:0}));
    if (session && connected) {
      button(t.load, async () => {
        const files = await invoke("github_list_notes",target);
        for (const file of files) {
          const path = typeof file === "string" ? file : file.path;
          button(path,async () => {
            const existing = (await getPending(target.accountId)).find(r => r.path === path && r.repositoryId === target.repositoryId);
            if (existing) return openEditor(existing);
            const remote = await get({...target,path});
            if (!remote) throw new Error("NOT_FOUND");
            return openEditor({...target,path,markdown:remote.markdown,baseMarkdown:remote.markdown,baseSha:remote.blobSha,revision:0});
          });
        }
      });
    }
    const rows = await getPending(binding.accountId);
    content.append(node("h3",t.pending));
    if (!rows.length) content.append(node("p",t.clean));
    for (const row of rows.filter(r => r.repositoryId === binding.repositoryId && r.branch === binding.branch)) {
      const line = node("div");
      line.append(node("span",(row.state === "conflict" ? t.conflict+" · " : "")+row.path));
      button(t.edit,() => openEditor(row),line);
      if (row.state === "pending" && session && connected) button(t.send, async () => {
        const result = await syncOne(row,{get,put});
        await show();
        status.textContent = ({synced:t.synced, conflict:t.conflict,busy:t.busy,pending:t.retry})[result];
      },line);
      content.append(line);
    }
    if (rows.length) button(t.export, async () => download(await exportPending(binding.accountId),"didaske-pending.json","application/json"));
  }

  async function connect(create) {
    const repo = await invoke("github_notes",{accountId:Number(session.id),repositoryId:binding?.repositoryId ?? null,create});
    if (Number(repo.ownerId) !== Number(session.id) || repo.name !== "Notes" || (binding && binding.repositoryId !== Number(repo.id))) throw new Error("REPOSITORY_CHANGED");
    binding = {accountId:Number(session.id),repositoryId:Number(repo.id),branch:repo.defaultBranch};
    await setPreference("notes-account",String(binding.accountId),binding);
    await setPreference("notes","offlineAccount",binding.accountId);
    connected = true;
    await show();
  }

  async function login() {
    const attempt = ++pollGeneration;
    const start = await invoke("github_start");
    content.replaceChildren(node("p",t.code), node("strong",start.userCode));
    button(t.cancel,async () => { pollGeneration++; await invoke("github_logout"); await show(); });
    const expiry = Date.now()+start.expiresIn*1000;
    let interval = start.interval;
    while (Date.now()<expiry && attempt===pollGeneration && panel.isConnected) {
      await new Promise(resolve=>setTimeout(resolve,interval*1000));
      if (attempt !== pollGeneration || !panel.isConnected) return;
      const response = await invoke("github_poll");
      if (response.user) { await show(); return; }
      interval = response.interval || interval;
      if (!["pending","slow_down","authorization_pending"].includes(response.state)) throw new Error(response.state);
    }
    if (attempt===pollGeneration && panel.isConnected) { await invoke("github_logout"); await show(); }
  }
  show().catch(() => { status.textContent = t.failed; });
}
