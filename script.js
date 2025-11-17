const TODO_STORAGE_KEY = "liststorage";

let liststorage = {
  fetch: () => JSON.parse(localStorage.getItem(TODO_STORAGE_KEY) || "{}"),
  save: lists => localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(lists))
};

var saveTimeoutObject;

const randomId = function(length = 6) {
  return Math.random().toString(36).substring(2, length+2);
};

function saveOnline(id, data){
      
        fetch("https://post-274723231011.europe-west1.run.app?id="+id, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)})
        .then(function(res){ return res.json(); })
        .catch(e => {
          console.log(e)
        })
    };

function getOnline(id, callback){
      fetch("https://get-274723231011.europe-west1.run.app?id="+id, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }})
        .then(function(res){ 
          return res.json()
           })
        .then(function(json) {
          callback(json)
        })
        .catch(e => {
          console.log(e)
        })
    }


const app = new Vue({
  el: "#app",
  data: () => {
    return {
      lists: liststorage.fetch(),
      newItemMap: {},
      dragging: -1
    };
  },
  methods: {
    addList() {

      var self  =this;
      //var listName = prompt('List name')

      var promptData = prompt('Enter name for new list or id to add shared list');

      var listId = promptData || randomId();

      if(!this.lists[listId]) {
        if(promptData.length == 6)  // taken from online
        {
          getOnline(listId, data => {
            try {
                    Vue.set(self.lists, listId, data)
                  } catch(e) {
                    console.log(e)
                    Vue.set(self.lists, listId, [{title:listId, bg:""}])
                  }
          })
        } else Vue.set(this.lists, listId, [{title:listId, bg:""}])//[{title:"sf", done:false}]
      } 
      else alert('name already exists')

    },
    removeList(listId){
      if(confirm('Delete list?'))
        Vue.delete(this.lists, listId);
    },
    addItem(listId) {
      if (!this.newItemMap[listId]) {
        return;
      }
      if(!this.lists[listId]) this.lists[listId] = []
      this.lists[listId].push({
        title: this.newItemMap[listId],
        done: false
      });
      this.newItemMap[listId] = "";
    },
    removeItem(item, listId) {
      this.lists[listId].splice(this.lists[listId].indexOf(item), 1);
    },
    removeItemAt(index, listId) {
      this.lists[listId].splice(index, 1);
    },
    dragStart(which, ev, listId) {
      ev.dataTransfer.setData('Text', this.id);
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
      this.dragging = -1
    },
    dragFinish(to, ev, listId) {
      this.moveItem(this.dragging, to, listId);
      ev.target.style.marginTop = '2px'
      ev.target.style.marginBottom = '2px'
    },
    moveItem(from, to, listId) {
      if (to === -1) {
        this.removeItemAt(from, listId);
      } else {
        this.lists[listId].splice(to, 0, this.lists[listId].splice(from, 1)[0]);
      }
    },
    fetchOnlineLists(){

    var self = this;


     //Vue.nextTick(function () {
          var lists = liststorage.fetch();
          Object.keys(lists).forEach(listId => {
            if(lists[listId][0]){
              if(lists[listId][0].online){

                getOnline(listId, data => {
                  console.log('listdataonline', data, listId, self.$data)
                  try {
                    self.lists[listId] = data
                  } catch(e) {
                    console.log(e)
                  }
                  
                })

              }
            }

          })
        //})
    }
  },
  computed: {
    isDragging() {
      return this.dragging > -1
    }
  },
  // watch lists change for localStorage persistence
  watch: {
    lists: {
      handler: function(lists) {
        clearTimeout(saveTimeoutObject);
        saveTimeoutObject = setTimeout(() => {
          var tmpLists = liststorage.fetch();

          liststorage.save(lists);


          Object.keys(lists).forEach(listKey => {
            if(tmpLists[listKey]){
              if(JSON.stringify(lists[listKey]) != JSON.stringify(tmpLists[listKey]))
              {
                console.log(lists[listKey])
                if((lists[listKey][0] || {}).online)
                  saveOnline(listKey, lists[listKey])
              }
            }
          })

        },700)
        
      },
      deep: true
    }
  }, 
  mounted(){
    try {
      let el = document.querySelector(".input-wrap .input");
      let widthMachine = document.querySelector(".input-wrap .width-machine");
      el.addEventListener("keyup", () => {
        widthMachine.innerHTML = el.value;
      });
    } catch(e){}

    this.fetchOnlineLists();
  }
});
