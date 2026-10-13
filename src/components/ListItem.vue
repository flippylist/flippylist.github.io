<script setup>
import ContentInput from './ContentInput.vue';

defineProps({ item: { type: Object, required: true } });
defineEmits(['edit', 'done', 'remove']);
</script>

<template>
  <li class="todo-item" :class="{ checked: item.done }" draggable="true">
    <input
      type="checkbox"
      :checked="item.done"
      :aria-label="`Mark ${item.title || 'item'} complete`"
      @change="$emit('done', $event.target.checked)"
    />
    <ContentInput
      :model-value="item.title"
      label="Item text"
      @update:model-value="$emit('edit', $event)"
    />
    <button
      class="remove-item"
      type="button"
      :aria-label="`Remove ${item.title || 'item'}`"
      @click="$emit('remove')"
    >
      &times;
    </button>
  </li>
</template>
