// The page's own script. It is the only place that knows how to talk to the API.
let token = null;
let cursor = null;

const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}

// Fire-and-forget analytics on every action.
const track = (name) => fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });

async function loadNotes(append) {
  const tag = $("tag").value;
  const query = new URLSearchParams({ limit: "3" });
  if (tag) query.set("tag", tag);
  if (append && cursor) query.set("cursor", cursor);
  const { data } = await api("GET", `/notes?${query}`);
  if (!append) $("notes").replaceChildren();
  for (const note of data.items) {
    const item = document.createElement("li");
    item.textContent = note.title;
    item.dataset.id = String(note.id);
    item.addEventListener("click", () => showNote(note.id));
    $("notes").append(item);
  }
  cursor = data.next_cursor;
  $("more").hidden = cursor === null;
}

async function showNote(id) {
  const { data } = await api("GET", `/notes/${id}`);
  $("detail").textContent = `${data.title}: ${data.body}`;
  track("open_note");
}

$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const { status, data } = await api("POST", "/session", { username: $("username").value, password: $("password").value });
  if (status !== 200) {
    $("login-error").textContent = "Wrong username or password";
    return;
  }
  token = data.token;
  $("login").hidden = true;
  $("notebook").hidden = false;
  const me = await api("GET", "/me");
  $("who").textContent = `Signed in as ${me.data.name}`;
  await loadNotes(false);
  track("signed_in");
});

$("tag").addEventListener("change", () => loadNotes(false));
$("more").addEventListener("click", () => loadNotes(true));
$("new-note").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("POST", "/notes", { title: $("new-title").value, body: $("new-body").value, tags: ["work"] });
  $("new-title").value = "";
  $("new-body").value = "";
  await loadNotes(false);
  track("add_note");
});
