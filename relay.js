const Gun = require('gun');
const server = require('http').createServer().listen(8765, () => {
    console.log('Gun relay running on http://localhost:8765/gun');
});
const gun = Gun({ web: server });
