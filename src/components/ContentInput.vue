<script setup>
defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  placeholder: { type: String, default: '' },
  enterkeyhint: { type: String, default: undefined },
});
defineEmits(['update:modelValue']);
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
      :enterkeyhint="enterkeyhint"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  </span>
</template>
