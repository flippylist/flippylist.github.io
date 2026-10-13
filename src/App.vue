<script setup>
import { onMounted, onUnmounted } from 'vue';
import ListCard from './components/ListCard.vue';

const props = defineProps({ workspace: { type: Object, required: true } });
const { lists, statuses, storageError, actions } = props.workspace;
let disconnect;
onMounted(() => {
  disconnect = props.workspace.connect(window);
});
onUnmounted(() => {
  disconnect?.();
  props.workspace.dispose();
});
</script>

<template>
  <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
  <ListCard
    v-for="(list, id) in lists"
    :key="id"
    :list-id="id"
    :list="list"
    :status="statuses[id]"
    @title="actions.editTitle(id, $event)"
    @color="actions.editColor(id, $event)"
    @edit-item="(index, title) => actions.editItem(id, index, title)"
    @done="(index, done) => actions.setDone(id, index, done)"
    @add-item="actions.addItem(id, $event)"
    @remove-item="actions.removeItem(id, $event)"
    @move="(from, to) => actions.moveItem(id, from, to)"
    @remove="actions.removeList(id)"
    @toggle="actions.toggleOnline(id)"
    @retry="actions.retrySync(id)"
    @load="actions.loadOnlineCopy(id)"
    @publish="actions.publishList(id)"
    @resolve="actions.resolveList(id)"
    @share="actions.shareAgain(id)"
  />
  <button class="add-list" aria-label="Add or open a list" @click="actions.addList">+</button>
</template>
