<script setup>
defineProps({
  status: { type: Object, required: true },
  online: Boolean,
});
defineEmits(['retry-delete', 'share', 'retry', 'load', 'publish', 'resolve']);
</script>

<template>
  <div v-if="status.error" class="sync-error" role="alert">
    {{ status.error }}
    <button
      v-if="status.deletion === 'pending'"
      :disabled="status.activity === 'delete'"
      @click="$emit('retry-delete')"
    >
      Retry delete
    </button>
    <button v-if="status.deletion === 'deleted'" @click="$emit('share')">Share as new list</button>
    <div v-if="online && status.deletion === 'none'">
      <button @click="$emit('retry')">Retry sync</button>
      <button @click="$emit('load')">Load online copy</button>
      <button v-if="status.missing" @click="$emit('publish')">Publish this copy</button>
      <button v-if="status.conflictRevision" @click="$emit('resolve')">
        Use this device’s copy
      </button>
    </div>
  </div>
</template>
