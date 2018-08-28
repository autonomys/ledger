
const module_name = {
  some_property: 'hello subspace',
  sync_method: () => {
    // describe method
    return module_name.some_property
  },
  async_method: async () => {
    // describe method
    try {
      return module_name.some_property
    }
    catch(error) {
      console.log('An error occcured')
      console.log(error)
    }
  }
}

export default module_name