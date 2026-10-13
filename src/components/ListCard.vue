<script setup>
import { computed, ref } from 'vue';
import ContentInput from './ContentInput.vue';
import ListItem from './ListItem.vue';
import SyncStatus from './SyncStatus.vue';

const props = defineProps({
  listId: { type: String, required: true },
  list: { type: Array, required: true },
  status: { type: Object, required: true },
});
const emit = defineEmits([
  'title',
  'color',
  'edit-item',
  'done',
  'add-item',
  'remove-item',
  'move',
  'remove',
  'toggle',
  'retry',
  'load',
  'publish',
  'resolve',
  'share',
]);
const header = computed(() => props.list[0]);
const items = computed(() => props.list.slice(1));
const draft = ref('');
const colorPicker = ref(null);
let dragging = null;

function addItem() {
  if (!draft.value) return;
  emit('add-item', draft.value);
  draft.value = '';
}
function startDrag(index, event) {
  dragging = index;
  event.dataTransfer.setData('text/plain', props.listId);
  event.dataTransfer.effectAllowed = 'move';
}
function finishDrag(index, event) {
  if (dragging !== null && event.dataTransfer.getData('text/plain') === props.listId) {
    emit('move', dragging, index);
  }
  dragging = null;
}
</script>

<template>
  <section
    class="list-wrapper"
    :style="{ background: header.bg }"
    :aria-label="header.title || 'List'"
  >
    <ul class="todo-list">
      <li class="todo-item list-heading">
        <ContentInput
          :model-value="header.title"
          label="List title"
          @update:model-value="emit('title', $event)"
          @dblclick="colorPicker?.click()"
        />
        <span class="list-id">
          <button
            class="delete-list"
            :disabled="status.activity === 'delete'"
            aria-label="Delete list"
            @click="emit('remove')"
          >
            X
          </button>
          <input
            ref="colorPicker"
            class="color-picker"
            type="color"
            :value="header.bg || '#e66465'"
            aria-label="List background color"
            @input="emit('color', $event.target.value)"
          />
          <button
            class="sync-toggle"
            :class="{ 'is-offline': !header.online }"
            :aria-label="header.online ? 'Pause sync' : 'Enable sync'"
            :aria-pressed="!!header.online"
            @click="emit('toggle')"
          >
            <i
              class="fa"
              :class="header.online ? 'fa-link' : 'fa-link-slash'"
              aria-hidden="true"
            ></i>
          </button>
          <span v-if="header.online">{{ listId }}</span>
        </span>
      </li>
      <ListItem
        v-for="(item, index) in items"
        :key="index"
        :item="item"
        @edit="emit('edit-item', index + 1, $event)"
        @done="emit('done', index + 1, $event)"
        @remove="emit('remove-item', index + 1)"
        @dragstart="startDrag(index + 1, $event)"
        @dragover.prevent
        @dragend="dragging = null"
        @drop="finishDrag(index + 1, $event)"
      />
      <li class="todo-item">
        <input type="checkbox" disabled aria-hidden="true" />
        <ContentInput v-model="draft" label="New item" placeholder="..." @submit="addItem" />
        <span v-if="draft">&crarr;</span>
      </li>
    </ul>
    <SyncStatus
      :status="status"
      :online="!!header.online"
      @retry-delete="emit('remove')"
      @share="emit('share')"
      @retry="emit('retry')"
      @load="emit('load')"
      @publish="emit('publish')"
      @resolve="emit('resolve')"
    />
  </section>
</template>
