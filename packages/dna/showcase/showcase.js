/* global document, matchMedia */
// The showcase page's behaviour: the theme list and the few states a static page has to imitate (what Radix does in
// the real components): a checked checkbox, a pressed toggle, the highlighted row of a list, focus following the
// pointer in a menu.
const root = document.documentElement;
const select = document.getElementById('theme');
const KEY = 'dna-showcase-theme';

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = id => {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // private window: the choice lives until reload
  }
};

const themes = await (await fetch('./themes.index.json')).json();
const apply = id => {
  const theme = themes.find(t => t.id === id) ?? themes[0];
  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-mode', theme.mode);
  select.value = theme.id;
  document.getElementById('theme-name').textContent = `${theme.name} · ${theme.mode}`;
};

for (const mode of ['light', 'dark']) {
  const group = document.createElement('optgroup');
  group.label = mode === 'light' ? 'Light' : 'Dark';
  for (const theme of themes.filter(t => t.mode === mode)) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    group.append(option);
  }
  select.append(group);
}
select.addEventListener('change', () => {
  apply(select.value);
  write(select.value);
});
apply(read() ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'default-dark' : 'default-light'));

// Checkbox: data-state checked / unchecked, the mark only when checked.
for (const box of document.querySelectorAll('[role="checkbox"]:not([disabled])')) {
  box.addEventListener('click', () => {
    const on = box.getAttribute('data-state') !== 'checked';
    box.setAttribute('data-state', on ? 'checked' : 'unchecked');
    box.setAttribute('aria-checked', String(on));
    box.firstElementChild.hidden = !on;
  });
}

// Toggle: on / off; inside a group of one choice the others go off.
for (const toggle of document.querySelectorAll('[data-slot="toggle"], [data-slot="toggle-group-item"]')) {
  toggle.addEventListener('click', () => {
    const group = toggle.closest('[data-single]');
    if (group) {
      for (const other of group.querySelectorAll('[data-slot="toggle-group-item"]')) {
        other.setAttribute('data-state', other === toggle ? 'on' : 'off');
      }
    } else {
      toggle.setAttribute('data-state', toggle.getAttribute('data-state') === 'on' ? 'off' : 'on');
    }
  });
}

// Tabs: one active trigger per list.
for (const trigger of document.querySelectorAll('[data-slot="tabs-trigger"]')) {
  trigger.addEventListener('click', () => {
    for (const other of trigger.parentElement.children) {
      other.setAttribute('data-state', other === trigger ? 'active' : 'inactive');
    }
  });
}

// Menus: the row under the pointer has the focus (the look is `focus:`). Lists: it is data-highlighted.
for (const item of document.querySelectorAll('[data-menu-item]')) {
  item.addEventListener('pointermove', () => item.focus({ preventScroll: true }));
  item.addEventListener('pointerleave', () => item.blur());
}
for (const item of document.querySelectorAll('[data-slot="select-item"]')) {
  item.addEventListener('pointermove', () => item.setAttribute('data-highlighted', ''));
  item.addEventListener('pointerleave', () => item.removeAttribute('data-highlighted'));
}
