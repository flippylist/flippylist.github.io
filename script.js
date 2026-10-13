const app = new Vue({
  el: "#app",
  data: () => {
    return {
      lists: liststorage.fetch(),
      newItemMap: {},
      dragging: -1,
      draggingListId: null,
      syncErrors: {},
      syncConflicts: {},
      missingOnline: {},
      deletedOnline: {},
      deletePending: {},
      deletingLists: {},
      storageError: ''
    };
  },
  methods: {
    pickColor(listId) {
      const picker = document.getElementById('colorPicker' + listId);
      if (picker) picker.click();
    },
    async addList() {
      const answer = prompt('Enter id or leave blank for new list');
      if (answer === null) return;
      let listId = answer.trim();
      if (!listId) {
        listId = newListId(this.lists);
      }
      if (['__proto__', 'constructor', 'prototype'].includes(listId) ||
          Object.prototype.hasOwnProperty.call(this.lists, listId)) {
        alert('That list id is already in use or is invalid.');
        return;
      }
      if (answer.trim()) {
        try {
          await this.$listSync.import(listId);
        } catch (error) {
          alert('Could not open the list: ' + error.message);
        }
      } else {
        Vue.set(this.lists, listId, [{ title: '...', bg: '', online: false }]);
      }
    },
    toggleOnline(listId) {
      this.$listSync.toggle(listId);
    },
    retrySync(listId) {
      this.$listSync.load(listId);
    },
    publishList(listId) {
      if (confirm('Publish this device’s copy to the new server? Check that it contains the items you want to keep.')) {
        this.$listSync.publish(listId);
      }
    },
    resolveList(listId, version) {
      if (confirm('Use this version for everyone? The other saved versions will remain in the history.')) {
        this.$listSync.resolve(listId, version);
      }
    },
    loadOnlineCopy(listId) {
      if (confirm('Replace this device’s list with the online copy? Your current copy will be kept in the recovery backup.')) {
        this.$listSync.load(listId, true);
      }
    },
    removeList(listId) {
      if (!this.lists[listId]) return;
      const state = this.$listSync.state(listId);
      if (state.deleting) return;
      const remote = state.deletePending || !state.unpublished || state.attempted || this.lists[listId][0].online;
      if (confirm(remote
        ? 'Delete this list from this device and delete all its online contents and history? Other devices keep their own copies but can no longer sync this ID.'
        : 'Delete this local list?')) return this.$listSync.remove(listId);
    },
    shareAgain(listId) {
      if (confirm('Share this copy with a new six-character ID? Other devices will need the new ID to sync with it.')) {
        return this.$listSync.shareAgain(listId);
      }
    },
    addItem(listId) {
      if (!this.newItemMap[listId]) {
        return;
      }
      if (!isValidList(this.lists[listId])) return;
      this.lists[listId].push({
        title: this.newItemMap[listId],
        done: false
      });
      this.newItemMap[listId] = "";
    },
    removeItem(item, listId) {
      this.removeItemAt(this.lists[listId].indexOf(item), listId);
    },
    removeItemAt(index, listId) {
      const list = this.lists[listId];
      if (list && Number.isInteger(index) && index > 0 && index < list.length) {
        list.splice(index, 1);
      }
    },
    dragStart(which, ev, listId) {
      ev.dataTransfer.setData('Text', listId);
      this.draggingListId = listId;
      ev.dataTransfer.dropEffect = 'move'
      this.dragging = which;
    },
    dragEnter(ev) {
      /* 
      if (ev.clientY > ev.target.height / 2) {
        ev.target.style.marginBottom = '10px'
      } else {
        ev.target.style.marginTop = '10px'
      }
      */
    },
    dragLeave(ev) {
      /* 
      ev.target.style.marginTop = '2px'
      ev.target.style.marginBottom = '2px'
      */
    },
    dragEnd(ev) {
      this.dragging = -1;
      this.draggingListId = null;
    },
    dragFinish(to, ev, listId) {
      if (this.draggingListId === listId) this.moveItem(this.dragging, to, listId);
      this.dragEnd();
      ev.target.style.marginTop = '2px'
      ev.target.style.marginBottom = '2px'
    },
    moveItem(from, to, listId) {
      const list = this.lists[listId];
      if (!list || !Number.isInteger(from) || from <= 0 || from >= list.length ||
          !Number.isInteger(to) || (to !== -1 && (to <= 0 || to >= list.length))) return;
      if (to === -1) {
        this.removeItemAt(from, listId);
      } else {
        this.lists[listId].splice(to, 0, this.lists[listId].splice(from, 1)[0]);
      }
    },
    fetchOnlineLists() {
      Object.keys(this.lists).forEach(listId => {
        const list = this.lists[listId];
        if (isValidList(list) && list[0].online) this.$listSync.load(listId);
      });
    }
  },
  computed: {
    isDragging() {
      return this.dragging > -1
    }
  },
  created() {
    this.$listSync = new ListSync(this);
  },
  watch: {
    lists: {
      handler() {
        this.$listSync.changed();
      },
      deep: true
    }
  },
  mounted() {
    this.fetchOnlineLists();
    // Local persistence is immediate; only uploads are debounced.
    window.addEventListener('pagehide', () => this.$listSync.changed());
    window.addEventListener('focus', () => this.fetchOnlineLists());
    window.addEventListener('online', () => this.fetchOnlineLists());
  }
});
