import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { mount } from '@vue/test-utils';
import App from '../src/App.vue';
import ListCard from '../src/components/ListCard.vue';
import { access, browser, list, token } from './helpers.js';

const mounted = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});
function mountApp(lists = { local: [{ title: 'Local', bg: '', online: false }] }) {
  const b = browser(lists);
  const wrapper = mount(App, { props: { workspace: b.workspace }, attachTo: document.body });
  mounted.push(wrapper);
  return { ...b, wrapper };
}

test('the UI edits and checks items, and keeps title/background controls wired', async () => {
  const b = mountApp();
  await b.wrapper.get('[aria-label="List title"]').setValue('Shopping');
  await b.wrapper.get('[aria-label="New item"]').setValue('Milk');
  await b.wrapper.get('form').trigger('submit');
  await b.wrapper.get('[aria-label="Mark Milk complete"]').setValue(true);
  await b.wrapper.get('[aria-label="List background color"]').setValue('#e0e9f1');
  await b.flush();
  assert.deepEqual(b.saved().local, [
    { title: 'Shopping', bg: '#e0e9f1', online: false },
    { title: 'Milk', done: true },
  ]);
  assert.equal(b.wrapper.get('[aria-label="New item"]').element.value, '');
  assert.ok(b.wrapper.get('.todo-item.checked').exists());
});

test('each list submits its own new item without key-up events or changing other drafts', async () => {
  const ids = ['first', 'middle', 'last'];
  const b = mountApp(Object.fromEntries(ids.map((id) => [id, [{ title: id, online: false }]])));
  const cards = b.wrapper.findAllComponents(ListCard);
  for (let index = 0; index < cards.length; index++) {
    const input = cards[index].get('[aria-label="New item"]');
    assert.equal(input.attributes('enterkeyhint'), 'enter');
    assert.equal(input.element.form, cards[index].get('form').element);
    await input.setValue('Item for ' + ids[index]);
  }
  for (let index = 0; index < cards.length; index++) {
    const event = new Event('submit', { bubbles: true, cancelable: true });
    cards[index].get('form').element.dispatchEvent(event);
    await b.flush();
    assert.equal(event.defaultPrevented, true, 'submission must not navigate away');
    assert.equal(b.saved()[ids[index]][1].title, 'Item for ' + ids[index]);
    assert.equal(cards[index].get('[aria-label="New item"]').element.value, '');
    for (let next = index + 1; next < cards.length; next++) {
      assert.equal(b.saved()[ids[next]].length, 1);
      assert.equal(
        cards[next].get('[aria-label="New item"]').element.value,
        'Item for ' + ids[next],
      );
    }
    await cards[index].get('form').trigger('submit');
    await b.flush();
    assert.equal(b.saved()[ids[index]].length, 2, 'an empty or repeated submit adds nothing');
  }
  assert.equal(b.requests.length, 0);
});

test('the return arrow submits only its own list', async () => {
  const b = mountApp({
    first: [{ title: 'First', online: false }],
    last: [{ title: 'Last', online: false }],
  });
  const cards = b.wrapper.findAllComponents(ListCard);
  await cards[0].get('[aria-label="New item"]').setValue('Milk');
  cards[0].get('[aria-label="Add item"]').element.click();
  await b.flush();
  assert.equal(b.saved().first[1].title, 'Milk');
  assert.equal(b.saved().last.length, 1);
  assert.equal(cards[0].get('[aria-label="New item"]').element.value, '');
});

test('adding a list initializes its sync status before rendering', async () => {
  const b = mountApp({});
  b.context.prompt = () => '';
  await b.wrapper.get('.add-list').trigger('click');
  await b.flush();
  assert.equal(b.wrapper.findAllComponents(ListCard).length, 1);
  const id = Object.keys(b.saved())[0];
  assert.match(id, /^[a-v0-9]{6}$/);
  assert.equal(b.workspace.statuses[id].publication, 'local');
});

test('dragging reorders within a list and ignores a drop from another list', async () => {
  const data = list('Milk', 'Bread');
  data[0].online = false;
  const b = mountApp({
    first: data,
    second: [
      { title: 'Other', online: false },
      { title: 'Eggs', done: false },
    ],
  });
  const cards = b.wrapper.findAllComponents(ListCard);
  let transferred = '';
  const dataTransfer = {
    setData: (_, value) => {
      transferred = value;
    },
    getData: () => transferred,
  };
  const rows = cards[0].findAll('[draggable]');
  await rows[0].trigger('dragstart', { dataTransfer });
  await cards[1].get('[draggable]').trigger('drop', { dataTransfer });
  await b.flush();
  assert.equal(b.saved().second[1].title, 'Eggs');
  await rows[1].trigger('drop', { dataTransfer });
  await b.flush();
  assert.equal(b.saved().first[1].title, 'Bread');
  assert.equal(b.saved().first[2].title, 'Milk');
});

test('delete and sync actions use the controller and preserve the confirmation', async () => {
  const b = mountApp({
    local: [
      { title: 'Local', online: false },
      { title: 'Milk', done: false },
    ],
  });
  await b.wrapper.get('[aria-label="Remove Milk"]').trigger('click');
  await b.flush();
  assert.equal(b.saved().local.length, 1);
  b.context.confirm = () => false;
  await b.wrapper.get('[aria-label="Delete list"]').trigger('click');
  assert.ok(b.saved().local);
  b.context.confirm = () => true;
  await b.wrapper.get('[aria-label="Delete list"]').trigger('click');
  await b.flush();
  assert.deepEqual(b.saved(), {});
  assert.equal(b.requests.length, 0);
});

test('double-clicking the title opens that list’s color picker', async () => {
  const b = mountApp();
  const picker = b.wrapper.get('[aria-label="List background color"]').element;
  let opened = 0;
  picker.click = () => {
    opened++;
  };
  await b.wrapper.get('[aria-label="List title"]').trigger('dblclick');
  assert.equal(opened, 1);
});

test('the PIN button sets a PIN on an existing list through the workspace', async () => {
  const b = mountApp({ shared: list('Milk') });
  b.requests[0].reply(list('Milk'));
  await b.tick();
  await b.wrapper.get('[aria-label="Set list PIN"]').trigger('click');
  assert.deepEqual(JSON.parse(b.posts()[0].body), {
    revision: null,
    pin: '123456',
    action: 'pin',
  });
  b.posts()[0].reply({ list: list('Milk'), revision: token(list('Milk')), access, hasPin: true });
  await b.tick();
  assert.ok(b.wrapper.get('[aria-label="Change list PIN"]').exists());
  assert.deepEqual(b.saved().shared, list('Milk'));
});
