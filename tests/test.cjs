// test.cjs for commonjs
const { Daffodil } = require("../index.cjs");

const deployer = new Daffodil({
  remoteUser: "deployer", // username of cloud server
  remoteHost: "231.142.34.222", // replace this with actual working ip address of  vps or cloud server
  remotePath: "/root/test", // target root
});

const steps = [
  { step: "list local directory.", command: () => deployer.runCommand("ls -a") },
  { step: "List remote directory.", command: () => deployer.sshCommand("ls -a") },
];

deployer.deploy(steps);
