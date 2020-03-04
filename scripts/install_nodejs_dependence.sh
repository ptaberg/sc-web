#!/bin/bash

apt-get -y install nodejs
apt-get -y install npm
npm cache clean -f
npm install -g n
n stable
echo "Installing grunt"
npm install -g grunt-cli
