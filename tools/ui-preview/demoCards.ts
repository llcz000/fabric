/** Review-only synthetic records. Never used for customer links or production permissions. */
export type DemoProduct = {no:string;name:string;media:[number,number,number]};
export type DemoCard = {id:string;cardNo:string;masterNo:string;fabricNo:string;fabricName:string;composition:string;weight:string;colors:string[];products:DemoProduct[]};
export const PILOT_CARDS:readonly DemoCard[]=[
 {id:'demo-1',cardNo:'SC-G0886-F018',masterNo:'G0886',fabricNo:'F018',fabricName:'轻薄雪纺',composition:'聚酯纤维 100%',weight:'75 g/m²',colors:['G0886-1','G0886-2','G0886-3'],products:[
  {no:'G0886-1-F018',name:'晨雾花卉',media:[2,2,1]},{no:'G0886-2-F018',name:'玫瑰花影',media:[1,2,2]},{no:'G0886-3-F018',name:'柔光花园',media:[2,1,1]}]},
 {id:'demo-2',cardNo:'SC-G0379-F021',masterNo:'G0379',fabricNo:'F021',fabricName:'真丝乔其',composition:'桑蚕丝 100%',weight:'12 mm',colors:['G0379-1','G0379-2'],products:[
  {no:'G0379-1-F021',name:'轻盈印花',media:[2,1,2]},{no:'G0379-2-F021',name:'层叠花色',media:[1,2,1]}]},
 {id:'demo-3',cardNo:'SC-G0626-F018',masterNo:'G0626',fabricNo:'F018',fabricName:'轻薄雪纺',composition:'聚酯纤维 100%',weight:'75 g/m²',colors:['G0626-1','G0626-2','G0626-3'],products:[
  {no:'G0626-1-F018',name:'度假条纹',media:[2,2,2]},{no:'G0626-2-F018',name:'明亮条纹',media:[1,2,2]}]},
 {id:'demo-4',cardNo:'SC-G0531-F033',masterNo:'G0531',fabricNo:'F033',fabricName:'棉麻混纺',composition:'棉 60% / 亚麻 40%',weight:'140 g/m²',colors:['G0531-1'],products:[
  {no:'G0531-1-F033',name:'自然肌理',media:[2,1,1]}]}
];
