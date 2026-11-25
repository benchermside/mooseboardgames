// Design T11: find this task's public DNS name, which CloudFront uses as the
// origin for the match (design D6). The server writes it to the match record
// itself, so no other Lambda has to.
import { DescribeNetworkInterfacesCommand } from '@aws-sdk/client-ec2';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * metadataUri: ECS_CONTAINER_METADATA_URI_V4, which Fargate sets. When it's
 *   unset (running locally) there's no public name, so this returns undefined.
 * ec2: an EC2Client (or anything with send()).
 * fetch: injectable for tests.
 *
 * Resolves to the public DNS name, e.g. ec2-1-2-3-4.compute-1.amazonaws.com.
 * Throws if it can't be found after `attempts` tries, `retryMs` apart.
 */
export async function findOriginHost({ metadataUri, ec2, fetch = globalThis.fetch, attempts = 10, retryMs = 1000 }) {
    if (!metadataUri) {
        return undefined;
    }

    // The task's network interface: its private IP and MAC address.
    const response = await fetch(metadataUri);
    if (!response.ok) {
        throw new Error(`Container metadata returned ${response.status}`);
    }
    const network = (await response.json()).Networks?.[0];
    const privateIp = network?.IPv4Addresses?.[0];
    const mac = network?.MACAddress;
    if (!privateIp || !mac) {
        throw new Error('Container metadata has no network address');
    }

    const command = new DescribeNetworkInterfacesCommand({
        Filters: [
            { Name: 'mac-address', Values: [mac] },
            { Name: 'addresses.private-ip-address', Values: [privateIp] },
        ],
    });
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const { NetworkInterfaces } = await ec2.send(command);
        const name = NetworkInterfaces?.[0]?.Association?.PublicDnsName;
        if (name) {
            return name;
        }
        if (attempt < attempts) {
            await sleep(retryMs);
        }
    }
    throw new Error(`No public DNS name for ${privateIp} after ${attempts} tries`);
}
