interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  description: string;
  logo: string;
  navLinks: {
    name: string;
    url: string;
  }[];
}

const data: ISiteMetadataResult = {
  siteTitle: '黑影儿的跑步记录',
  siteUrl: 'https://runningpage.libo.run',
  logo: 'https://gravatar.com/avatar/f3b1c5be916ba231f6c5b1c6388c6158?size=512',
  description: '跑过的路，都不会白费',
  navLinks: [
    {
      name: 'YouTube',
      url: 'https://www.youtube.com/@shadow-runner',
    },
    {
      name: 'BiliBili',
      url: 'https://space.bilibili.com/38995440',
    },
    {
      name: 'WeChat',
      url: 'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=MjM5MTUxMDgwNA==&scene=124#wechat_redirect',
    },
    {
      name: 'Patreon',
      url: 'https://www.patreon.com/shadowrunning',
    },
  ],
};

export default data;
