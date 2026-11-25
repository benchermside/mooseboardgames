// T11: finding the task's public DNS name, with fake metadata and EC2.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findOriginHost } from '../src/origin.js';

const METADATA_URI = 'http://169.254.170.2/v4/abc';
const DNS_NAME = 'ec2-1-2-3-4.compute-1.amazonaws.com';

function fakeFetch(body = { Networks: [{ IPv4Addresses: ['172.31.5.6'], MACAddress: '0a:1b:2c:3d:4e:5f' }] }) {
    const urls = [];
    const fetch = async url => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => body };
    };
    return { fetch, urls };
}

/** Answers DescribeNetworkInterfaces with each of `names` in turn (undefined = no name yet). */
function fakeEc2(names) {
    const inputs = [];
    const ec2 = {
        async send(command) {
            inputs.push(command.input);
            const name = names[Math.min(inputs.length - 1, names.length - 1)];
            return { NetworkInterfaces: [{ Association: name === undefined ? {} : { PublicDnsName: name } }] };
        },
    };
    return { ec2, inputs };
}

test('running locally (no metadata URI) there is no origin', async () => {
    const { ec2, inputs } = fakeEc2([DNS_NAME]);
    assert.equal(await findOriginHost({ metadataUri: undefined, ec2 }), undefined);
    assert.equal(inputs.length, 0);
});

test('finds the public DNS name of the task\'s network interface', async () => {
    const { fetch, urls } = fakeFetch();
    const { ec2, inputs } = fakeEc2([DNS_NAME]);
    assert.equal(await findOriginHost({ metadataUri: METADATA_URI, ec2, fetch }), DNS_NAME);
    assert.deepEqual(urls, [METADATA_URI]);
    assert.deepEqual(inputs[0].Filters, [
        { Name: 'mac-address', Values: ['0a:1b:2c:3d:4e:5f'] },
        { Name: 'addresses.private-ip-address', Values: ['172.31.5.6'] },
    ]);
});

test('retries until the name appears', async () => {
    const { fetch } = fakeFetch();
    const { ec2, inputs } = fakeEc2([undefined, undefined, DNS_NAME]);
    assert.equal(await findOriginHost({ metadataUri: METADATA_URI, ec2, fetch, retryMs: 1 }), DNS_NAME);
    assert.equal(inputs.length, 3);
});

test('gives up if the name never appears', async () => {
    const { fetch } = fakeFetch();
    const { ec2, inputs } = fakeEc2([undefined]);
    await assert.rejects(findOriginHost({ metadataUri: METADATA_URI, ec2, fetch, attempts: 3, retryMs: 1 }), /No public DNS name/);
    assert.equal(inputs.length, 3);
});

test('metadata without a network address is an error', async () => {
    const { fetch } = fakeFetch({ Networks: [] });
    const { ec2 } = fakeEc2([DNS_NAME]);
    await assert.rejects(findOriginHost({ metadataUri: METADATA_URI, ec2, fetch }), /no network address/);
});
