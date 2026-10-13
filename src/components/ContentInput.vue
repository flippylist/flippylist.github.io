<script setup>
defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  placeholder: { type: String, default: '' },
});
defineEmits(['update:modelValue', 'submit']);
</script>

<template>
  <span class="input-wrap">
    <span class="width-machine" aria-hidden="true">{{ modelValue }}</span>
    <input
      class="input"
      type="text"
      :aria-label="label"
      :value="modelValue"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', $event.target.value)"
      @keyup.enter="$emit('submit')"
    />
  </span>
</template>
